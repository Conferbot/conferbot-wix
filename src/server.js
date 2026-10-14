'use strict';

const express = require('express');
const wix = require('./wix');
const ShopStore = require('./store');
const { extractBotId, isValidBotId, buildEmbeddedScriptHtml } = require('./widgetScript');
const { renderAdminPage } = require('./adminPage');
const session = require('./session');

const INSTANCE_RE = /^[a-zA-Z0-9-]+$/;

/**
 * App factory - config injected so tests can point installerBase/apiBase at
 * a mock Wix. Returns { app, store }.
 *
 * Wix flow: user adds the app -> Wix opens {appUrl}/auth/start?token=... ->
 * we bounce to the Wix installer -> Wix redirects to /auth/callback?code=
 * &instanceId= -> token exchange -> after every settings save we push the
 * embedded-script parameters ({{botId}}/{{embedType}}) for the site.
 */
function createApp(cfg) {
  const app = express();
  const store = new ShopStore(cfg.dataFile);

  app.use(express.urlencoded({ extended: false }));

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  app.get('/logo.png', (req, res) => res.sendFile(require('path').join(__dirname, '..', 'logo.png')));

  // ---- OAuth ------------------------------------------------------------------

  app.get('/auth/start', (req, res) => {
    const token = String(req.query.token || '');
    if (!token) {
      return res.status(400).send('Missing installer token');
    }
    const params = new URLSearchParams({
      token,
      appId: cfg.appId,
      redirectUrl: `${cfg.appUrl}/auth/callback`,
    });
    res.redirect(`${cfg.installerBase}/installer/install?${params}`);
  });

  app.get('/auth/callback', async (req, res) => {
    try {
      const { code, instanceId } = req.query;
      if (!code || !INSTANCE_RE.test(String(instanceId || ''))) {
        return res.status(400).send('Missing code or invalid instanceId');
      }
      const tokens = await wix.exchangeCodeForTokens({ code, cfg });
      const existing = store.get(instanceId);
      store.upsert(instanceId, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || '',
        enabled: existing ? existing.enabled : false,
      });
      const pageToken = session.issueToken(instanceId, cfg.appSecret, 10 * 60 * 1000);
      res.redirect(`/app?instanceId=${encodeURIComponent(instanceId)}&session=${encodeURIComponent(pageToken)}`);
    } catch (e) {
      res.status(502).send('Installation failed: ' + e.message);
    }
  });

  // ---- Settings page (in production opened in the Wix admin with ?instance=) -----

  app.get('/app', (req, res) => {
    // Only the site's own admin: Wix's signed instance token, or the
    // short-lived token from the install. A bare ?instanceId= let anyone
    // open or save any site's settings.
    let instanceId = String(req.query.instanceId || '');
    let allowed = false;
    if (req.query.instance) {
      const payload = wix.verifyInstance(req.query.instance, cfg.appSecret);
      if (!payload) {
        return res.status(403).send('Invalid instance token');
      }
      instanceId = String(payload.instanceId || '');
      allowed = true;
    }
    if (!INSTANCE_RE.test(instanceId)) {
      return res.status(400).send('Missing or invalid instance');
    }
    allowed = allowed || session.verifyToken(String(req.query.session || ''), instanceId, cfg.appSecret);
    if (!store.get(instanceId) || !allowed) {
      return res.status(401).send('Open Conferbot from your Wix dashboard (Apps > Manage Apps).');
    }
    res.send(renderAdminPage({
      instanceId,
      record: store.get(instanceId),
      demoBotId: cfg.demoBotId,
      saved: req.query.saved === '1',
      formToken: session.issueToken(instanceId, cfg.appSecret),
    }));
  });

  app.post('/app/save', async (req, res) => {
    const instanceId = String(req.body.instanceId || '');
    if (!INSTANCE_RE.test(instanceId)) {
      return res.status(400).send('Missing or invalid instanceId');
    }
    const formToken = String(req.body.token || '');
    if (!store.get(instanceId) || !session.verifyToken(formToken, instanceId, cfg.appSecret)) {
      return res.status(401).send('This settings page has expired. Open Conferbot from your Wix dashboard again.');
    }
    const botId = extractBotId(req.body.botId);
    const enabled = req.body.enabled === '1' && isValidBotId(botId);
    const embedType = req.body.embedType === 'popup_chat' ? 'popup_chat' : 'live_chat';
    const record = store.upsert(instanceId, { botId, enabled, embedType });

    // Push parameters into the site's embedded script when we have a token.
    if (record.accessToken) {
      const parameters = { botId: enabled ? botId : '', embedType };
      try {
        try {
          await wix.embedScript({ accessToken: record.accessToken, parameters, cfg });
        } catch (e) {
          // Wix access tokens are short-lived: refresh once and retry.
          if (e.status !== 401 || !record.refreshToken) throw e;
          const tokens = await wix.refreshTokens({ refreshToken: record.refreshToken, cfg });
          store.upsert(instanceId, { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || record.refreshToken });
          await wix.embedScript({ accessToken: tokens.access_token, parameters, cfg });
        }
      } catch (e) {
        return res.status(502).send('Saved locally but Wix rejected the embed update: ' + e.message);
      }
    }
    res.redirect(`/app?instanceId=${encodeURIComponent(instanceId)}&session=${encodeURIComponent(formToken)}&saved=1`);
  });

  // ---- Preview of the embedded script (production equivalent lives in the
  //      Wix Dev Center as embedded-script.html) -------------------------------

  app.get('/preview/embedded-script.js', (req, res) => {
    const instanceId = String(req.query.instanceId || '');
    res.type('text/html');
    if (!INSTANCE_RE.test(instanceId)) {
      return res.send('<!-- conferbot: invalid instance -->\n');
    }
    const record = store.get(instanceId);
    if (!record || !record.enabled) {
      return res.send('<!-- conferbot: not configured -->\n');
    }
    res.send(buildEmbeddedScriptHtml(record.botId, record.embedType, cfg));
  });

  return { app, store };
}

module.exports = createApp;

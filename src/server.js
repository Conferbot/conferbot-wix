'use strict';

const express = require('express');
const wix = require('./wix');
const ShopStore = require('./store');
const { extractBotId, isValidBotId, buildEmbeddedScriptHtml } = require('./widgetScript');
const { renderAdminPage } = require('./adminPage');

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
      res.redirect(`/app?instanceId=${encodeURIComponent(instanceId)}`);
    } catch (e) {
      res.status(502).send('Installation failed: ' + e.message);
    }
  });

  // ---- Settings page (in production opened in the Wix admin with ?instance=) -----

  app.get('/app', (req, res) => {
    // Accept either a signed instance token (production) or a bare
    // instanceId (draft/dev usage, like the other Conferbot apps).
    let instanceId = String(req.query.instanceId || '');
    if (!instanceId && req.query.instance) {
      const payload = wix.verifyInstance(req.query.instance, cfg.appSecret);
      if (!payload) {
        return res.status(403).send('Invalid instance token');
      }
      instanceId = String(payload.instanceId || '');
    }
    if (!INSTANCE_RE.test(instanceId)) {
      return res.status(400).send('Missing or invalid instance');
    }
    res.send(renderAdminPage({
      instanceId,
      record: store.get(instanceId),
      demoBotId: cfg.demoBotId,
      saved: req.query.saved === '1',
    }));
  });

  app.post('/app/save', async (req, res) => {
    const instanceId = String(req.body.instanceId || '');
    if (!INSTANCE_RE.test(instanceId)) {
      return res.status(400).send('Missing or invalid instanceId');
    }
    const botId = extractBotId(req.body.botId);
    const enabled = req.body.enabled === '1' && isValidBotId(botId);
    const embedType = req.body.embedType === 'popup_chat' ? 'popup_chat' : 'live_chat';
    const record = store.upsert(instanceId, { botId, enabled, embedType });

    // Push parameters into the site's embedded script when we have a token.
    if (record.accessToken) {
      try {
        await wix.embedScript({
          accessToken: record.accessToken,
          parameters: { botId: enabled ? botId : '', embedType },
          cfg,
        });
      } catch (e) {
        return res.status(502).send('Saved locally but Wix rejected the embed update: ' + e.message);
      }
    }
    res.redirect(`/app?instanceId=${encodeURIComponent(instanceId)}&saved=1`);
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

'use strict';

const express = require('express');
const wix = require('./wix');
const ShopStore = require('./store');
const { extractBotId, isValidBotId, buildEmbeddedScriptHtml } = require('./widgetScript');
const { renderAdminPage } = require('./adminPage');
const session = require('./session');

const INSTANCE_RE = /^[a-zA-Z0-9-]+$/;

/**
 * App factory - config injected so tests can point apiBase at a mock Wix.
 * Returns { app, store }.
 *
 * Wix flow (OAuth, client credentials): the merchant adds the app and
 * consents in Wix -> Wix sends the App Instance Installed webhook (the site's
 * instanceId) -> the merchant opens the app's dashboard page, an iframe of
 * {appUrl}/app?instance=<signed> -> every settings save takes an access token
 * for that instance (POST /oauth2/token) and pushes the embedded-script
 * parameters ({{botId}}/{{embedType}}) for the site.
 */
function createApp(cfg) {
  const app = express();
  const store = new ShopStore(cfg.dataFile);
  const tokens = cfg.tokenCache || wix.createTokenCache(cfg);

  // A site record. Access tokens are no longer stored: the fields legacy
  // installs wrote are cleared on the next write.
  const LEGACY_TOKEN_FIELDS = { accessToken: undefined, refreshToken: undefined };
  const ensureSite = (instanceId, patch = {}) => {
    const existing = store.get(instanceId);
    return store.upsert(instanceId, Object.assign({ enabled: existing ? !!existing.enabled : false }, LEGACY_TOKEN_FIELDS, patch));
  };

  // Push the site's embedded-script parameters. A token Wix refuses (revoked,
  // or expired early) is dropped and a fresh one is tried once.
  const pushEmbed = async (instanceId, parameters) => {
    try {
      await wix.embedScript({ accessToken: await tokens.get(instanceId), parameters, cfg });
    } catch (e) {
      if (e.status !== 401) throw e;
      tokens.drop(instanceId);
      await wix.embedScript({ accessToken: await tokens.get(instanceId), parameters, cfg });
    }
  };
  const embedParameters = (record) => ({
    botId: record.enabled && isValidBotId(record.botId) ? record.botId : '',
    embedType: record.embedType === 'popup_chat' ? 'popup_chat' : 'live_chat',
  });

  app.use(express.urlencoded({ extended: false }));

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  app.get('/logo.png', (req, res) => res.sendFile(require('path').join(__dirname, '..', 'logo.png')));

  // ---- Webhooks: App Instance Installed creates the site record, App Instance
  //      Removed drops it -------------------------------------------------------

  app.post('/webhooks', express.text({ type: '*/*', limit: '1mb' }), async (req, res) => {
    const event = wix.verifyWebhookJwt(req.body, cfg.webhookPublicKey);
    if (!event) {
      return res.status(401).send('Invalid webhook signature');
    }
    const instanceId = String(event.instanceId || '');
    const type = String(event.eventType || '');
    if (!INSTANCE_RE.test(instanceId)) {
      return res.status(200).send('ok');
    }
    if (/^(AppInstalled|app_installed|app_instance_installed)$/i.test(type)) {
      let data = {};
      try {
        data = typeof event.data === 'string' ? JSON.parse(event.data || '{}') : (event.data || {});
      } catch (e) {
        data = {};
      }
      // A duplicated site keeps the original site's settings (App Market
      // rule: copying a site copies the app's settings too).
      const origin = INSTANCE_RE.test(String(data.originInstanceId || '')) ? store.get(String(data.originInstanceId)) : null;
      const copied = origin && !store.get(instanceId)
        ? { botId: origin.botId || '', enabled: !!origin.enabled, embedType: origin.embedType }
        : {};
      const record = ensureSite(instanceId, copied);
      if (copied.enabled) {
        try {
          await pushEmbed(instanceId, embedParameters(record));
        } catch (e) {
          console.warn(`[conferbot] ${instanceId}: could not embed the copied settings: ${e.message}`);
        }
      }
    } else if (/^(AppRemoved|app_removed|app_instance_removed)$/i.test(type)) {
      store.remove(instanceId);
      tokens.drop(instanceId);
    }
    res.status(200).send('ok');
  });

  // ---- Settings page (in production opened in the Wix admin with ?instance=) -----

  // Settings may only be framed by the Wix dashboard (no clickjacking).
  const frameGuard = (req, res, next) => {
    res.set('Content-Security-Policy', 'frame-ancestors https://*.wix.com;');
    next();
  };

  app.get('/app', frameGuard, (req, res) => {
    // Only the site's own admin: Wix's signed instance token (the dashboard
    // page iframe), or the short-lived token the page hands itself after a
    // save. A bare ?instanceId= let anyone open or save any site's settings.
    let instanceId = String(req.query.instanceId || '');
    let allowed = false;
    if (req.query.instance) {
      const payload = wix.verifyInstance(req.query.instance, cfg.appSecret, { appId: cfg.appId });
      if (!payload) {
        return res.status(403).send('Invalid instance token');
      }
      instanceId = String(payload.instanceId || '');
      allowed = true;
    }
    if (!INSTANCE_RE.test(instanceId)) {
      return res.status(400).send('Missing or invalid instance');
    }
    // Wix signed this instance, so the site is real even if its App Instance
    // Installed webhook has not arrived (or never will): start its record.
    if (allowed && !store.get(instanceId)) {
      ensureSite(instanceId);
    }
    allowed = allowed || session.verifyToken(String(req.query.session || ''), instanceId, cfg.appSecret);
    if (!store.get(instanceId) || !allowed) {
      return res.status(401).send('Open Conferbot from your Wix dashboard (Apps > Conferbot).');
    }
    res.send(renderAdminPage({
      instanceId,
      record: store.get(instanceId),
      demoBotId: cfg.demoBotId,
      saved: req.query.saved === '1',
      formToken: session.issueToken(instanceId, cfg.appSecret),
    }));
  });

  app.post('/app/save', frameGuard, async (req, res) => {
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
    const record = ensureSite(instanceId, { botId, enabled, embedType });

    // Push the parameters into the site's embedded script.
    try {
      await pushEmbed(instanceId, embedParameters(record));
    } catch (e) {
      return res.status(502).send('Saved locally but Wix rejected the embed update: ' + e.message);
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

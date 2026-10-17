'use strict';

/**
 * End-to-end test: mock Wix (OAuth client-credentials token endpoint, Embed
 * Script API, signed webhooks) plus the real app, driven through the full
 * journey. Nothing here calls Wix: apiBase points at the local mock.
 * Browser stage (RUN_BROWSER_E2E=1) renders a fake Wix site page containing
 * the embedded-script output and asserts the real CDN widget mounts.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const createApp = require('../src/server');
const wixHelpers = require('../src/wix');
const { extractBotId, isValidBotId, buildEmbeddedScriptHtml } = require('../src/widgetScript');

const INSTANCE_ID = 'demo-instance-1';
const LEGACY_ID = 'legacy-instance-0';
const APP_ID = 'test-wix-app-id';
const APP_SECRET = 'test-wix-app-secret';
const DEMO_ID = '691c970890527a0468f9b2c9';
const WEBHOOK_KEYS = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

let mockWix;
let appServer;
let appUrl;
const mockState = { tokenRequests: [], embedCalls: [], issuedToken: 'wix-mock-token', validToken: 'wix-mock-token' };
let dataFile;

function makeInstanceToken(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${sig}.${body}`;
}

function wixJwt(event, key = WEBHOOK_KEYS.privateKey, alg = 'RS256') {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg, typ: 'JWT' });
  const body = enc({ data: JSON.stringify(event), iat: Math.floor(Date.now() / 1000) });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url');
  return `${head}.${body}.${sig}`;
}

const postHook = (jwt) => fetch(`${appUrl}/webhooks`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: jwt });

before(async () => {
  mockWix = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'POST' && url.pathname === '/oauth2/token') {
        const reqBody = JSON.parse(body);
        mockState.tokenRequests.push(reqBody);
        res.setHeader('Content-Type', 'application/json');
        if (reqBody.grant_type !== 'client_credentials' || reqBody.client_secret !== APP_SECRET || !reqBody.instance_id) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ error: 'invalid_request' }));
        }
        return res.end(JSON.stringify({ access_token: mockState.issuedToken, token_type: 'Bearer', expires_in: 14400 }));
      }
      if (req.method === 'POST' && url.pathname === '/apps/v1/scripts') {
        if (req.headers.authorization !== mockState.validToken) {
          res.statusCode = 401;
          return res.end('{}');
        }
        mockState.embedCalls.push(Object.assign(JSON.parse(body), { auth: req.headers.authorization }));
        res.setHeader('Content-Type', 'application/json');
        return res.end('{}');
      }
      res.statusCode = 404;
      res.end('not found');
    });
  });
  await new Promise((r) => mockWix.listen(0, r));

  dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cbwix-')), 'sites.json');
  // A site installed with the legacy custom authentication: tokens on disk.
  fs.writeFileSync(dataFile, JSON.stringify({
    [LEGACY_ID]: { accessToken: 'legacy-access', refreshToken: 'legacy-refresh', botId: DEMO_ID, enabled: true, embedType: 'live_chat' },
  }));
  const cfg = {
    port: 0,
    appUrl: '',
    appId: APP_ID,
    appSecret: APP_SECRET,
    webhookPublicKey: WEBHOOK_KEYS.publicKey.export({ type: 'spki', format: 'pem' }),
    apiBase: `http://localhost:${mockWix.address().port}`,
    widgetScriptUrl: 'https://cdn.conferbot.com/dist/v1/widget.min.js',
    demoBotId: DEMO_ID,
    dataFile,
  };
  const { app } = createApp(cfg);
  appServer = http.createServer(app);
  await new Promise((r) => appServer.listen(0, r));
  appUrl = `http://localhost:${appServer.address().port}`;
  cfg.appUrl = appUrl;
});

after(async () => {
  await new Promise((r) => appServer.close(r));
  await new Promise((r) => mockWix.close(r));
});

// ---- helpers -------------------------------------------------------------------

test('instance token verification accepts valid, rejects tampered/malformed/stale', () => {
  const now = new Date().toISOString();
  const good = makeInstanceToken({ instanceId: INSTANCE_ID, signDate: now, appDefId: APP_ID }, APP_SECRET);
  assert.strictEqual(wixHelpers.verifyInstance(good, APP_SECRET, { appId: APP_ID }).instanceId, INSTANCE_ID);
  const stale = makeInstanceToken({ instanceId: INSTANCE_ID, signDate: '2024-01-01T00:00:00Z' }, APP_SECRET);
  assert.strictEqual(wixHelpers.verifyInstance(stale, APP_SECRET), null);
  const undated = makeInstanceToken({ instanceId: INSTANCE_ID }, APP_SECRET);
  assert.strictEqual(wixHelpers.verifyInstance(undated, APP_SECRET), null);
  const otherApp = makeInstanceToken({ instanceId: INSTANCE_ID, signDate: now, appDefId: 'other-app' }, APP_SECRET);
  assert.strictEqual(wixHelpers.verifyInstance(otherApp, APP_SECRET, { appId: APP_ID }), null);
  const wrongSecret = makeInstanceToken({ instanceId: INSTANCE_ID, signDate: now }, 'other');
  assert.strictEqual(wixHelpers.verifyInstance(wrongSecret, APP_SECRET), null);
  assert.strictEqual(wixHelpers.verifyInstance('nodots', APP_SECRET), null);
  assert.strictEqual(wixHelpers.verifyInstance('', APP_SECRET), null);
});

test('bot id helpers match the other conferbot integrations', () => {
  assert.strictEqual(extractBotId(`ConferbotWidget("${DEMO_ID}")`), DEMO_ID);
  assert.strictEqual(extractBotId(''), '');
  assert.ok(isValidBotId(DEMO_ID));
  assert.ok(!isValidBotId('zz'));
});

test('embedded script html is inert when unconfigured and sanitized when not', () => {
  assert.match(buildEmbeddedScriptHtml('', 'live_chat', { widgetScriptUrl: 'x' }), /not configured/);
  const html = buildEmbeddedScriptHtml(DEMO_ID, 'weird_type', { widgetScriptUrl: 'https://cdn.x/w.js?"><script>' });
  assert.ok(html.includes(`'${DEMO_ID}', 'live_chat'`));
  assert.ok(!html.includes('"><script>'));
});

// ---- the journey ------------------------------------------------------------------

test('oauth: a client-credentials token per instance, reused until it nears expiry', async () => {
  let clock = 0;
  const calls = [];
  const cache = wixHelpers.createTokenCache({}, {
    now: () => clock,
    request: async ({ instanceId }) => { calls.push(instanceId); return { accessToken: `t${calls.length}`, expiresInMs: 4 * 60 * 60 * 1000 }; },
  });
  assert.strictEqual(await cache.get('a'), 't1');
  clock = 3 * 60 * 60 * 1000;
  assert.strictEqual(await cache.get('a'), 't1');
  assert.strictEqual(await cache.get('b'), 't2');
  clock = 4 * 60 * 60 * 1000 - 60 * 1000; // within five minutes of expiry
  assert.strictEqual(await cache.get('a'), 't3');
  cache.drop('a');
  assert.strictEqual(await cache.get('a'), 't4');
  assert.deepStrictEqual(calls, ['a', 'b', 'a', 'a']);
});

test('oauth: the token request is the documented client-credentials body', async () => {
  const before = mockState.tokenRequests.length;
  const cfg = { apiBase: `http://localhost:${mockWix.address().port}`, appId: APP_ID, appSecret: APP_SECRET };
  const token = await wixHelpers.createAccessToken({ instanceId: INSTANCE_ID, cfg });
  assert.deepStrictEqual(token, { accessToken: 'wix-mock-token', expiresInMs: 14400 * 1000 });
  assert.deepStrictEqual(mockState.tokenRequests.at(-1), {
    grant_type: 'client_credentials', client_id: APP_ID, client_secret: APP_SECRET, instance_id: INSTANCE_ID,
  });
  await assert.rejects(wixHelpers.createAccessToken({ instanceId: INSTANCE_ID, cfg: { ...cfg, appSecret: 'wrong' } }), /HTTP 400/);
  assert.strictEqual(mockState.tokenRequests.length, before + 2);
  mockState.tokenRequests.length = 0;
});

test('the legacy install redirect and code exchange are gone', async () => {
  assert.strictEqual((await fetch(`${appUrl}/auth/start?token=x`, { redirect: 'manual' })).status, 404);
  assert.strictEqual((await fetch(`${appUrl}/auth/callback?code=x&instanceId=${INSTANCE_ID}`, { redirect: 'manual' })).status, 404);
});

test('step 1: App Instance Installed creates the site record, switched off', async () => {
  const res = await postHook(wixJwt({ eventType: 'AppInstalled', instanceId: INSTANCE_ID, data: JSON.stringify({ appId: APP_ID }) }));
  assert.strictEqual(res.status, 200);
  const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'))[INSTANCE_ID];
  assert.deepStrictEqual(saved, { enabled: false });
  assert.match(await (await fetch(`${appUrl}/preview/embedded-script.js?instanceId=${INSTANCE_ID}`)).text(), /not configured/);
  // Installing needs no Wix call: no token yet, nothing embedded.
  assert.strictEqual(mockState.tokenRequests.length, 0);
  assert.strictEqual(mockState.embedCalls.length, 0);
});

let formToken; // the settings page's signed form token

test('step 3: settings page opens only via the signed instance token', async () => {
  const token = makeInstanceToken({ instanceId: INSTANCE_ID, signDate: new Date().toISOString(), appDefId: APP_ID }, APP_SECRET);
  const signed = await fetch(`${appUrl}/app?instance=${encodeURIComponent(token)}`);
  assert.strictEqual(signed.status, 200);
  assert.strictEqual(signed.headers.get('content-security-policy'), 'frame-ancestors https://*.wix.com;');
  const html = await signed.text();
  assert.ok(html.includes('Paste your Chatbot ID'));
  assert.ok(html.includes(`data-demo-id="${DEMO_ID}"`));
  formToken = html.match(/name="token" value="([^"]+)"/)[1];

  // A bare ?instanceId= (the old hole) and a forged instance are refused.
  assert.strictEqual((await fetch(`${appUrl}/app?instanceId=${INSTANCE_ID}`)).status, 401);
  assert.strictEqual((await fetch(`${appUrl}/app?instance=abc.def`)).status, 403);
});

test('step 3a: the dashboard page still opens when the install webhook never arrived', async () => {
  const lost = 'webhook-lost-3';
  assert.strictEqual((await fetch(`${appUrl}/app?instanceId=${lost}`)).status, 401);
  const token = makeInstanceToken({ instanceId: lost, signDate: new Date().toISOString(), appDefId: APP_ID }, APP_SECRET);
  const res = await fetch(`${appUrl}/app?instance=${encodeURIComponent(token)}`);
  assert.strictEqual(res.status, 200);
  assert.ok((await res.text()).includes('Paste your Chatbot ID'));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(dataFile, 'utf8'))[lost], { enabled: false });
});

test('step 3b: saving without the page token, or with another site\'s, is refused', async () => {
  const session = require('../src/session');
  const post = (fields) => fetch(`${appUrl}/app/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ instanceId: INSTANCE_ID, botId: 'aaaaaaaaaaaaaaaaaaaaaaaa', enabled: '1', ...fields }),
    redirect: 'manual',
  });
  assert.strictEqual((await post({})).status, 401);
  assert.strictEqual((await post({ token: session.issueToken('other-site', APP_SECRET) })).status, 401);
  assert.strictEqual((await post({ token: session.issueToken(INSTANCE_ID, 'wrong-secret') })).status, 401);
  assert.strictEqual(mockState.embedCalls.length, 0);
});

test('step 4: saving pushes embedded-script parameters to wix', async () => {
  const body = new URLSearchParams({
    instanceId: INSTANCE_ID,
    botId: `window.ConferbotWidget("${DEMO_ID}", "live_chat")`,
    enabled: '1',
    embedType: 'live_chat',
    token: formToken,
  });
  const res = await fetch(`${appUrl}/app/save`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, redirect: 'manual',
  });
  assert.strictEqual(res.status, 302);
  assert.deepStrictEqual(mockState.embedCalls.at(-1), {
    properties: { parameters: { botId: DEMO_ID, embedType: 'live_chat' } }, auth: 'wix-mock-token',
  });
  assert.deepStrictEqual(mockState.tokenRequests, [
    { grant_type: 'client_credentials', client_id: APP_ID, client_secret: APP_SECRET, instance_id: INSTANCE_ID },
  ]);
  // The token is never written to disk.
  assert.ok(!fs.readFileSync(dataFile, 'utf8').includes('wix-mock-token'));

  // A second save reuses the cached token.
  await fetch(`${appUrl}/app/save`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, redirect: 'manual',
  });
  assert.strictEqual(mockState.tokenRequests.length, 1);
  assert.strictEqual(mockState.embedCalls.length, 2);
});

test('step 4a: turning the chat off empties the bot ID in the embedded script', async () => {
  const body = new URLSearchParams({ instanceId: INSTANCE_ID, botId: DEMO_ID, embedType: 'live_chat', token: formToken });
  const res = await fetch(`${appUrl}/app/save`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, redirect: 'manual',
  });
  assert.strictEqual(res.status, 302);
  assert.deepStrictEqual(mockState.embedCalls.at(-1).properties, { parameters: { botId: '', embedType: 'live_chat' } });
});

test('step 4b: a token Wix refuses is replaced with a new one and the save goes through', async () => {
  mockState.issuedToken = 'wix-mock-token-2';
  mockState.validToken = 'wix-mock-token-2'; // the cached token no longer works
  const before = mockState.tokenRequests.length;
  const body = new URLSearchParams({ instanceId: INSTANCE_ID, botId: DEMO_ID, enabled: '1', embedType: 'popup_chat', token: formToken });
  const res = await fetch(`${appUrl}/app/save`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, redirect: 'manual',
  });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(mockState.tokenRequests.length, before + 1);
  assert.strictEqual(mockState.tokenRequests.at(-1).grant_type, 'client_credentials');
  assert.deepStrictEqual(mockState.embedCalls.at(-1), { properties: { parameters: { botId: DEMO_ID, embedType: 'popup_chat' } }, auth: 'wix-mock-token-2' });

  // Wix refusing the new token too is reported, not hidden.
  mockState.validToken = 'nothing-works';
  const failed = await fetch(`${appUrl}/app/save`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, redirect: 'manual',
  });
  assert.strictEqual(failed.status, 502);
  mockState.validToken = 'wix-mock-token-2';

  // back to the live-chat embed the next steps expect
  const again = new URLSearchParams({ instanceId: INSTANCE_ID, botId: DEMO_ID, enabled: '1', embedType: 'live_chat', token: formToken });
  assert.strictEqual((await fetch(`${appUrl}/app/save`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: again, redirect: 'manual' })).status, 302);
});

test('step 4d: a site installed with the legacy auth moves to OAuth on its next save', async () => {
  const session = require('../src/session');
  const body = new URLSearchParams({ instanceId: LEGACY_ID, botId: DEMO_ID, enabled: '1', embedType: 'live_chat', token: session.issueToken(LEGACY_ID, APP_SECRET) });
  const res = await fetch(`${appUrl}/app/save`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, redirect: 'manual',
  });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(mockState.tokenRequests.at(-1).instance_id, LEGACY_ID);
  assert.notStrictEqual(mockState.embedCalls.at(-1).auth, 'legacy-access');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(dataFile, 'utf8'))[LEGACY_ID], { enabled: true, botId: DEMO_ID, embedType: 'live_chat' });
});

test('step 4c: the dev-center template does nothing while the chat is off', () => {
  const tpl = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'embedded-script.html'), 'utf8');
  const off = tpl.replace(/\{\{botId\}\}/g, '').replace(/\{\{embedType\}\}/g, 'live_chat');
  const js = off.match(/<script[^>]*>([\s\S]*)<\/script>/)[1];
  let created = 0;
  const doc = { getElementById: () => null, getElementsByTagName: () => [], createElement: () => { created += 1; return {}; }, head: { appendChild() {} } };
  new Function('document', js)(doc);
  assert.strictEqual(created, 0);
});

test('step 5: preview endpoint serves the rendered embedded script', async () => {
  const html = await (await fetch(`${appUrl}/preview/embedded-script.js?instanceId=${INSTANCE_ID}`)).text();
  assert.ok(html.includes(`'${DEMO_ID}', 'live_chat'`));
  assert.ok(html.includes('cdn.conferbot.com/dist/v1/widget.min.js'));

  const unknown = await (await fetch(`${appUrl}/preview/embedded-script.js?instanceId=other-site`)).text();
  assert.match(unknown, /not configured/);
});

test('step 6: real browser - widget mounts on a wix-like page', { skip: process.env.RUN_BROWSER_E2E !== '1' }, async () => {
  const puppeteer = require('puppeteer');
  const embedded = await (await fetch(`${appUrl}/preview/embedded-script.js?instanceId=${INSTANCE_ID}`)).text();

  const site = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><html><head>${embedded}</head><body><h1>Mock Wix site</h1></body></html>`);
  });
  await new Promise((r) => site.listen(0, r));

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${site.address().port}/`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('conferbot-widget', { timeout: 30000 });
    assert.strictEqual(await page.evaluate(() => typeof window.ConferbotWidget), 'function');
  } finally {
    await browser.close();
    await new Promise((r) => site.close(r));
  }
});

// ---- webhooks (last: App Removed deletes the site) ----------------------------

test('webhooks: unsigned, wrongly signed or non-RS256 events are refused', async () => {
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const removed = { eventType: 'AppRemoved', instanceId: INSTANCE_ID, data: '{}' };
  assert.strictEqual((await postHook('not-a-jwt')).status, 401);
  assert.strictEqual((await postHook(wixJwt(removed, other))).status, 401);
  assert.strictEqual((await postHook(wixJwt(removed, WEBHOOK_KEYS.privateKey, 'none'))).status, 401);
  const html = await (await fetch(`${appUrl}/preview/embedded-script.js?instanceId=${INSTANCE_ID}`)).text();
  assert.ok(html.includes(DEMO_ID));
});

test('webhooks: a duplicated site gets the original site\'s settings', async () => {
  const copy = 'copied-instance-2';
  const res = await postHook(wixJwt({ eventType: 'AppInstalled', instanceId: copy, data: JSON.stringify({ appId: APP_ID, originInstanceId: INSTANCE_ID }) }));
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(dataFile, 'utf8'))[copy], { enabled: true, botId: DEMO_ID, embedType: 'live_chat' });
  assert.strictEqual(mockState.tokenRequests.at(-1).instance_id, copy);
  assert.deepStrictEqual(mockState.embedCalls.at(-1).properties, { parameters: { botId: DEMO_ID, embedType: 'live_chat' } });
  // A repeated install event keeps the site's own settings.
  await postHook(wixJwt({ eventType: 'AppInstalled', instanceId: INSTANCE_ID, data: '{}' }));
  assert.strictEqual(JSON.parse(fs.readFileSync(dataFile, 'utf8'))[INSTANCE_ID].botId, DEMO_ID);
});

test('webhooks: App Removed deletes the site record and forgets its token', async () => {
  assert.strictEqual((await postHook(wixJwt({ eventType: 'AppRemoved', instanceId: INSTANCE_ID, data: '{}' }))).status, 200);
  const html = await (await fetch(`${appUrl}/preview/embedded-script.js?instanceId=${INSTANCE_ID}`)).text();
  assert.match(html, /not configured/);
  assert.strictEqual(JSON.parse(fs.readFileSync(dataFile, 'utf8'))[INSTANCE_ID], undefined);
  // The old page token no longer saves anything.
  const body = new URLSearchParams({ instanceId: INSTANCE_ID, botId: DEMO_ID, enabled: '1', token: formToken });
  assert.strictEqual((await fetch(`${appUrl}/app/save`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, redirect: 'manual' })).status, 401);
  // Reinstalled and opened from the dashboard again, the site starts switched off.
  const token = makeInstanceToken({ instanceId: INSTANCE_ID, signDate: new Date().toISOString() }, APP_SECRET);
  const page = await (await fetch(`${appUrl}/app?instance=${encodeURIComponent(token)}`)).text();
  assert.ok(page.includes('value=""'));
});

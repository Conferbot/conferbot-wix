'use strict';

/**
 * End-to-end test: mock Wix (installer redirect target, OAuth token endpoint,
 * Embed Script API) plus the real app, driven through the full journey.
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
const APP_ID = 'test-wix-app-id';
const APP_SECRET = 'test-wix-app-secret';
const DEMO_ID = '691c970890527a0468f9b2c9';
const WEBHOOK_KEYS = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

let mockWix;
let appServer;
let appUrl;
const mockState = { tokenRequests: [], embedCalls: [] , validToken: 'wix-mock-token' };

function makeInstanceToken(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${sig}.${body}`;
}

before(async () => {
  mockWix = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'POST' && url.pathname === '/oauth/access') {
        const reqBody = JSON.parse(body);
        mockState.tokenRequests.push(reqBody);
        res.setHeader('Content-Type', 'application/json');
        if (reqBody.grant_type === 'refresh_token') {
          return res.end(JSON.stringify({ access_token: mockState.validToken, refresh_token: 'wix-mock-refresh-2' }));
        }
        return res.end(JSON.stringify({ access_token: 'wix-mock-token', refresh_token: 'wix-mock-refresh' }));
      }
      if (req.method === 'GET' && url.pathname === '/apps/v1/instance') {
        res.setHeader('Content-Type', 'application/json');
        // every token the mock hands out belongs to INSTANCE_ID's site
        return res.end(JSON.stringify({ instance: { instanceId: INSTANCE_ID, appName: 'Conferbot' } }));
      }
      if (req.method === 'POST' && url.pathname === '/apps/v1/scripts') {
        if (req.headers.authorization !== mockState.validToken) {
          res.statusCode = 401;
          return res.end('{}');
        }
        mockState.embedCalls.push(JSON.parse(body));
        res.setHeader('Content-Type', 'application/json');
        return res.end('{}');
      }
      res.statusCode = 404;
      res.end('not found');
    });
  });
  await new Promise((r) => mockWix.listen(0, r));

  const dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cbwix-')), 'sites.json');
  const cfg = {
    port: 0,
    appUrl: '',
    appId: APP_ID,
    appSecret: APP_SECRET,
    webhookPublicKey: WEBHOOK_KEYS.publicKey.export({ type: 'spki', format: 'pem' }),
    installerBase: `http://localhost:${mockWix.address().port}`,
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

test('step 1: /auth/start bounces to the wix installer with app id and redirect', async () => {
  const res = await fetch(`${appUrl}/auth/start?token=install-token-9`, { redirect: 'manual' });
  assert.strictEqual(res.status, 302);
  const loc = new URL(res.headers.get('location'));
  assert.strictEqual(loc.pathname, '/installer/install');
  assert.strictEqual(loc.searchParams.get('token'), 'install-token-9');
  assert.strictEqual(loc.searchParams.get('appId'), APP_ID);
  assert.strictEqual(loc.searchParams.get('redirectUrl'), `${appUrl}/auth/callback`);
  installState = loc.searchParams.get('state');
  assert.ok(installState && installState.includes('~'));
});

let installState;

test('step 2: callback exchanges the code, checks the instance and closes the installer', async () => {
  const res = await fetch(`${appUrl}/auth/callback?code=grant-7&instanceId=${INSTANCE_ID}&state=${encodeURIComponent(installState)}`, { redirect: 'manual' });
  assert.strictEqual(res.status, 302);
  const loc = new URL(res.headers.get('location'));
  assert.strictEqual(loc.pathname, '/installer/close-window');
  assert.strictEqual(loc.searchParams.get('access_token'), 'wix-mock-token');
  assert.deepStrictEqual(mockState.tokenRequests[0], {
    grant_type: 'authorization_code', client_id: APP_ID, client_secret: APP_SECRET, code: 'grant-7',
  });
});

test('step 2a: callback refuses a forged state or a code for another site', async () => {
  const st = encodeURIComponent(installState);
  assert.strictEqual((await fetch(`${appUrl}/auth/callback?code=x&instanceId=${INSTANCE_ID}`, { redirect: 'manual' })).status, 403);
  assert.strictEqual((await fetch(`${appUrl}/auth/callback?code=x&instanceId=${INSTANCE_ID}&state=abc~def.0`, { redirect: 'manual' })).status, 403);
  // the mock's tokens belong to INSTANCE_ID, so claiming another site fails
  const before = mockState.tokenRequests.length;
  assert.strictEqual((await fetch(`${appUrl}/auth/callback?code=x&instanceId=victim-site&state=${st}`, { redirect: 'manual' })).status, 403);
  assert.strictEqual(mockState.tokenRequests.length, before + 1);
});

test('step 2b: callback rejects missing code or bad instance id', async () => {
  assert.strictEqual((await fetch(`${appUrl}/auth/callback?instanceId=${INSTANCE_ID}`, { redirect: 'manual' })).status, 400);
  assert.strictEqual((await fetch(`${appUrl}/auth/callback?code=x&instanceId=../evil`, { redirect: 'manual' })).status, 400);
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
    properties: { parameters: { botId: DEMO_ID, embedType: 'live_chat' } },
  });
});

test('step 4b: an expired access token is refreshed and the save goes through', async () => {
  mockState.validToken = 'wix-mock-token-2'; // the stored token no longer works
  const body = new URLSearchParams({ instanceId: INSTANCE_ID, botId: DEMO_ID, enabled: '1', embedType: 'popup_chat', token: formToken });
  const res = await fetch(`${appUrl}/app/save`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, redirect: 'manual',
  });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(mockState.tokenRequests.at(-1).grant_type, 'refresh_token');
  assert.strictEqual(mockState.tokenRequests.at(-1).refresh_token, 'wix-mock-refresh');
  assert.deepStrictEqual(mockState.embedCalls.at(-1), { properties: { parameters: { botId: DEMO_ID, embedType: 'popup_chat' } } });
  // back to the live-chat embed the next steps expect
  const again = new URLSearchParams({ instanceId: INSTANCE_ID, botId: DEMO_ID, enabled: '1', embedType: 'live_chat', token: formToken });
  await fetch(`${appUrl}/app/save`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: again, redirect: 'manual' });
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

function wixJwt(event, key = WEBHOOK_KEYS.privateKey, alg = 'RS256') {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg, typ: 'JWT' });
  const body = enc({ data: JSON.stringify(event), iat: Math.floor(Date.now() / 1000) });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url');
  return `${head}.${body}.${sig}`;
}

const postHook = (jwt) => fetch(`${appUrl}/webhooks`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: jwt });

test('webhooks: unsigned, wrongly signed or non-RS256 events are refused', async () => {
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const removed = { eventType: 'AppRemoved', instanceId: INSTANCE_ID, data: '{}' };
  assert.strictEqual((await postHook('not-a-jwt')).status, 401);
  assert.strictEqual((await postHook(wixJwt(removed, other))).status, 401);
  assert.strictEqual((await postHook(wixJwt(removed, WEBHOOK_KEYS.privateKey, 'none'))).status, 401);
  const html = await (await fetch(`${appUrl}/preview/embedded-script.js?instanceId=${INSTANCE_ID}`)).text();
  assert.ok(html.includes(DEMO_ID));
});

test('webhooks: App Removed deletes the site record and its tokens', async () => {
  assert.strictEqual((await postHook(wixJwt({ eventType: 'AppRemoved', instanceId: INSTANCE_ID, data: '{}' }))).status, 200);
  const html = await (await fetch(`${appUrl}/preview/embedded-script.js?instanceId=${INSTANCE_ID}`)).text();
  assert.match(html, /not configured/);
  const token = makeInstanceToken({ instanceId: INSTANCE_ID, signDate: new Date().toISOString() }, APP_SECRET);
  assert.strictEqual((await fetch(`${appUrl}/app?instance=${encodeURIComponent(token)}`)).status, 401);
});

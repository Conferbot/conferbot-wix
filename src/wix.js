'use strict';

const crypto = require('crypto');

/**
 * Wix OAuth + API helpers.
 *
 * Authentication is Wix OAuth (client credentials): the app ID, the app
 * secret and the site's instanceId give an access token. The instanceId
 * comes from the App Instance Installed webhook or the signed `instance`
 * parameter of the dashboard page; there is no installer redirect, no
 * authorization code and no refresh token.
 *
 * Wix identity: the app instance ID (one per site installation). The
 * settings iframe receives a signed `instance` token:
 *   "<base64url signature>.<base64url json payload>"
 * where the signature is HMAC-SHA256 of the payload part with the app secret.
 * The payload's signDate must be within a day and its appDefId (when set)
 * must be this app.
 */

function verifyInstance(instance, appSecret, { appId = '', now = Date.now(), maxAgeMs = 24 * 60 * 60 * 1000 } = {}) {
  const parts = String(instance || '').split('.');
  if (parts.length !== 2) {
    return null;
  }
  const [sigB64, payloadB64] = parts;
  const expected = crypto.createHmac('sha256', appSecret).update(payloadB64).digest('base64url');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(sigB64, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch (e) {
    return null;
  }
  // Wix signs a fresh instance on every dashboard load: an old one (from a
  // log, a shared link, browser history) must not open the settings forever.
  const signed = Date.parse(payload && payload.signDate);
  if (!Number.isFinite(signed) || Math.abs(now - signed) > maxAgeMs) {
    return null;
  }
  if (appId && payload.appDefId && payload.appDefId !== appId) {
    return null;
  }
  return payload;
}

/**
 * Wix webhooks arrive as a JWT (RS256) signed with the app's key; the public
 * key is in the Dev Center (Webhooks > Public key). The JWT payload's `data`
 * is a JSON string: { eventType, instanceId, data, identity }.
 * Returns that parsed object, or null when the signature, algorithm or
 * expiry is wrong.
 */
function verifyWebhookJwt(jwt, publicKey, now = Date.now()) {
  if (!publicKey) return null;
  const parts = String(jwt || '').trim().split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (header.alg !== 'RS256') return null;
    const ok = crypto.verify(
      'RSA-SHA256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      publicKey,
      Buffer.from(parts[2], 'base64url'),
    );
    if (!ok) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (payload.exp && payload.exp * 1000 < now) return null;
    const outer = typeof payload.data === 'string' ? JSON.parse(payload.data) : payload.data;
    return outer && typeof outer === 'object' ? outer : null;
  } catch (e) {
    return null;
  }
}

/**
 * OAuth (client credentials): an access token for one app instance, from
 * POST {apiBase}/oauth2/token. Wix returns no refresh token; a new token is
 * created whenever one is needed. Tokens are valid for 4 hours.
 * https://dev.wix.com/docs/build-apps/develop-your-app/auth/authenticate-using-oauth
 */
async function createAccessToken({ instanceId, cfg }) {
  const res = await fetch(`${cfg.apiBase}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: cfg.appId,
      client_secret: cfg.appSecret,
      instance_id: instanceId,
    }),
  });
  if (!res.ok) {
    const err = new Error(`access token request failed: HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  if (!data.access_token) {
    throw new Error('access token response had no access_token');
  }
  const seconds = Number(data.expires_in);
  return {
    accessToken: String(data.access_token),
    expiresInMs: (Number.isFinite(seconds) && seconds > 0 ? seconds : 4 * 60 * 60) * 1000,
  };
}

/**
 * Per-instance access tokens, kept in memory only (nothing to store or leak
 * on disk) and reused until five minutes before they expire.
 */
function createTokenCache(cfg, { now = () => Date.now(), request = createAccessToken } = {}) {
  const tokens = new Map();
  const MARGIN_MS = 5 * 60 * 1000;
  return {
    async get(instanceId) {
      const hit = tokens.get(instanceId);
      if (hit && hit.expiresAt - MARGIN_MS > now()) {
        return hit.accessToken;
      }
      const { accessToken, expiresInMs } = await request({ instanceId, cfg });
      tokens.set(instanceId, { accessToken, expiresAt: now() + expiresInMs });
      return accessToken;
    },
    drop(instanceId) {
      tokens.delete(instanceId);
    },
  };
}

/**
 * Pushes the per-site embedded-script parameters (the dev-center script
 * template contains {{botId}}/{{embedType}} placeholders).
 */
async function embedScript({ accessToken, parameters, cfg }) {
  const res = await fetch(`${cfg.apiBase}/apps/v1/scripts`, {
    method: 'POST',
    headers: {
      Authorization: accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ properties: { parameters } }),
  });
  if (!res.ok) {
    const err = new Error(`embed script failed: HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

module.exports = { verifyInstance, verifyWebhookJwt, createAccessToken, createTokenCache, embedScript };

'use strict';

const crypto = require('crypto');

/**
 * Wix OAuth + API helpers.
 *
 * Wix identity: the app instance ID (one per site installation). The
 * settings iframe receives a signed `instance` token:
 *   "<base64url signature>.<base64url json payload>"
 * where the signature is HMAC-SHA256 of the payload part with the app secret.
 */

function verifyInstance(instance, appSecret) {
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
  try {
    return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch (e) {
    return null;
  }
}

async function exchangeCodeForTokens({ code, cfg }) {
  const res = await fetch(`${cfg.apiBase}/oauth/access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: cfg.appId,
      client_secret: cfg.appSecret,
      code,
    }),
  });
  if (!res.ok) {
    throw new Error(`token exchange failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!data.access_token) {
    throw new Error('token exchange returned no access_token');
  }
  return data;
}

/** A fresh access token from the refresh token (Wix access tokens last minutes). */
async function refreshTokens({ refreshToken, cfg }) {
  const res = await fetch(`${cfg.apiBase}/oauth/access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: cfg.appId,
      client_secret: cfg.appSecret,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    throw new Error(`token refresh failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!data.access_token) {
    throw new Error('token refresh returned no access_token');
  }
  return data;
}

/**
 * The instance an access token belongs to (GET /apps/v1/instance). The
 * install callback uses it instead of trusting the instanceId in the URL.
 */
async function getInstanceId({ accessToken, cfg }) {
  const res = await fetch(`${cfg.apiBase}/apps/v1/instance`, {
    headers: { Authorization: accessToken },
  });
  if (!res.ok) {
    throw new Error(`instance lookup failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  const id = data && data.instance && data.instance.instanceId;
  if (!id) {
    throw new Error('instance lookup returned no instanceId');
  }
  return String(id);
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

module.exports = { verifyInstance, exchangeCodeForTokens, refreshTokens, getInstanceId, embedScript };

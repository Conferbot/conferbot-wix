'use strict';

const crypto = require('crypto');

/**
 * Short-lived tokens that tie a settings page (and its save) to one store.
 *
 * The admin page used to trust a bare ?instanceId= parameter, so anyone could open
 * or save any store's settings and point its chat at their own bot. Now the
 * page opens only from Wix's signed instance (or right after the install),
 * and the form carries a token signed with the app secret that the save
 * checks.
 *
 * Token: base64url("<store>|<expiry ms>") + "." + hex HMAC-SHA256 of that part.
 */

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64url');
const unb64url = (s) => Buffer.from(s, 'base64url').toString('utf8');

function sign(part, secret) {
  return crypto.createHmac('sha256', secret).update(part).digest('hex');
}

function issueToken(store, secret, ttlMs = 60 * 60 * 1000, now = Date.now()) {
  const part = b64url(`${store}|${now + ttlMs}`);
  return `${part}.${sign(part, secret)}`;
}

/** True when the token was issued by us for this store and has not expired. */
function verifyToken(token, store, secret, now = Date.now()) {
  if (typeof token !== 'string' || !secret) return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false;
  const part = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const want = Buffer.from(sign(part, secret), 'utf8');
  const got = Buffer.from(mac, 'utf8');
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return false;
  let decoded;
  try {
    decoded = unb64url(part);
  } catch (_) {
    return false;
  }
  const bar = decoded.lastIndexOf('|');
  if (bar < 1) return false;
  const tokenStore = decoded.slice(0, bar);
  const exp = Number(decoded.slice(bar + 1));
  return tokenStore === store && Number.isFinite(exp) && exp > now;
}

module.exports = { issueToken, verifyToken };

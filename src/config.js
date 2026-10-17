'use strict';

/**
 * Environment-driven configuration. API_BASE exists so tests can point the
 * Wix APIs (OAuth token, Embed Script) at a mock server.
 */
module.exports = {
  port: parseInt(process.env.PORT || '3059', 10),
  appUrl: process.env.APP_URL || 'http://localhost:3059',
  appId: process.env.WIX_APP_ID || '',
  appSecret: process.env.WIX_APP_SECRET || '',
  // App dashboard > Webhooks > Public key (PEM; "\n" escapes are accepted).
  // Needed for App Instance Installed / Removed.
  webhookPublicKey: (process.env.WIX_PUBLIC_KEY || '').replace(/\\n/g, '\n'),
  apiBase: process.env.WIX_API_BASE || 'https://www.wixapis.com',
  widgetScriptUrl: process.env.CONFERBOT_WIDGET_URL || 'https://cdn.conferbot.com/dist/v1/widget.min.js',
  demoBotId: '691c970890527a0468f9b2c9',
  dataFile: process.env.DATA_FILE || require('path').join(__dirname, '..', 'data', 'sites.json'),
};

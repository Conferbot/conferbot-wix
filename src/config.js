'use strict';

/**
 * Environment-driven configuration. INSTALLER_BASE/API_BASE exist so tests
 * can point the OAuth installer redirect and the Wix APIs at a mock server.
 */
module.exports = {
  port: parseInt(process.env.PORT || '3059', 10),
  appUrl: process.env.APP_URL || 'http://localhost:3059',
  appId: process.env.WIX_APP_ID || '',
  appSecret: process.env.WIX_APP_SECRET || '',
  installerBase: process.env.WIX_INSTALLER_BASE || 'https://www.wix.com',
  apiBase: process.env.WIX_API_BASE || 'https://www.wixapis.com',
  widgetScriptUrl: process.env.CONFERBOT_WIDGET_URL || 'https://cdn.conferbot.com/dist/v1/widget.min.js',
  demoBotId: '691c970890527a0468f9b2c9',
  dataFile: process.env.DATA_FILE || require('path').join(__dirname, '..', 'data', 'sites.json'),
};

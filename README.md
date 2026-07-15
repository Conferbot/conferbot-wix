# Conferbot Wix App

Installs the [Conferbot](https://conferbot.com) AI chat widget on a Wix site. Same product as the [Shopify](https://github.com/Conferbot/conferbot-shopify), [BigCommerce](https://github.com/Conferbot/conferbot-bigcommerce), [WordPress](https://github.com/Conferbot/conferbot-wordpress) and [PrestaShop](https://github.com/Conferbot/conferbot-prestashop) integrations, Wix-shaped: OAuth via the Wix installer, and an **embedded script** (registered in the Wix Dev Center from `embedded-script.html`) whose `{{botId}}`/`{{embedType}}` parameters this app pushes per site.

## See it in action

Paste the Chatbot ID in the app settings, save, and the chat is live (recorded against the mock Wix site from the e2e suite):

![Conferbot Wix demo](docs/demo.gif)

[HD video (MP4)](docs/demo.mp4)

## How it works

```
user adds the app from the Wix App Market
  -> Wix opens {APP_URL}/auth/start?token=...
  -> we bounce to https://www.wix.com/installer/install (appId + redirectUrl)
  -> Wix redirects to /auth/callback?code=&instanceId=
  -> code exchanged at wixapis.com/oauth/access -> tokens stored per instance

merchant saves settings (/app -> /app/save)
  -> app pushes {{botId}}/{{embedType}} via POST wixapis.com/apps/v1/scripts
  -> Wix renders the embedded script (embedded-script.html) on every page
  -> loader boots window.ConferbotWidget(botId, embedType,
       { customData: { platform: "wix" } })
```

The settings page accepts either a signed `?instance=` token (production, HMAC-verified with the app secret) or a bare `?instanceId=` (draft/dev). The only merchant-facing setting is the **Chatbot ID** (bare ID, full snippet, or URL - auto-extracted), with a one-click **demo bot** (`691c970890527a0468f9b2c9`) that works without a Conferbot account.

## Project layout

```
embedded-script.html   # THE template to paste into the Dev Center Embedded Script component
src/
├── index.js           # entrypoint
├── server.js          # /auth/start, /auth/callback, /app, /app/save, /preview/embedded-script.js
├── config.js          # env config (WIX_INSTALLER_BASE/WIX_API_BASE overridable for tests)
├── wix.js             # instance-token verify, OAuth token exchange, embed-script push
├── widgetScript.js    # bot ID helpers + local render of the embedded-script html
├── adminPage.js       # two-step settings page
└── store.js           # JSON-file instance store (swap for a real DB)
test/e2e.test.js       # helpers + full journey against a mock Wix + browser widget mount
```

## Setup

1. Create an app in the [Wix Dev Center](https://dev.wix.com): add an **Embedded Script** component (paste `embedded-script.html`, declare the `botId` and `embedType` parameters, placement: body end, load on all pages), set the App URL to `{APP_URL}/auth/start` and the Redirect URL to `{APP_URL}/auth/callback`.
2. Copy `.env.example` to `.env` with the app ID/secret. `APP_URL` must be public HTTPS.
3. `npm install && npm start`, then install the app on a free Wix test site from the Dev Center.

## Tests

```bash
npm test                    # helpers + install/settings/save journey (mock Wix APIs)
RUN_BROWSER_E2E=1 npm test  # + headless Chrome: the real CDN widget mounts on a mock Wix page
```

10 tests cover: instance-token verification (valid, wrong secret, malformed), installer redirect parameters, OAuth code exchange, settings rendering via both auth styles, save pushing the exact embed parameters to the Wix API, preview rendering, sanitization of the embedded-script output, and the browser mount.

## Production checklist (before App Market submission)

- [ ] Real database behind the instance store
- [ ] App removal webhook (instance cleanup)
- [ ] Wix Dashboard component so settings open inside the Wix admin
- [ ] App Market listing assets (see the submission guide)

## License

MIT.

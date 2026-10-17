# Wix App Market: submission kit

Everything needed to list the Conferbot Wix app (0.1.0) on the Wix App Market. Checked against dev.wix.com on 2026-10-17. **This app cannot be submitted yet.** The blockers below come first.

## 1. Where to submit

| What | Where |
| --- | --- |
| Account | A Wix account with a **Wix Dev Center / Wix Studio developer workspace**: https://dev.wix.com. Fill in the company info: company name (up to 23 characters, e.g. `Conferbot`), website, support email. https://dev.wix.com/docs/build-apps/launch-your-app/market-listing/add-your-company-info |
| Listing | Dev Center > your app > **App Market listing** (app info, media, pricing). https://dev.wix.com/docs/build-apps/launch-your-app/market-listing/add-your-app-info |
| Submission | Dev Center > your app > **Submit & Publish**. Review is automated (AI); it either publishes the app or lists blockers to fix. https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/submit-your-first-app-version |
| Guidelines | https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/app-market-guidelines |
| Fees | No listing fee. If the app ever charges through Wix: an 80/20 split, with 100% to you for the first 12 months, and payouts above $200. This app is free. |

## 2. Current requirements and where we stand

| Requirement | Status |
| --- | --- |
| **OAuth.** Custom (legacy) authentication is deprecated and not available to new apps. | **Blocker, #6.** 0.1.0 uses the legacy installer redirect plus `authorization_code`. |
| Site-wide script through an **embedded script extension**, and a **dashboard page** for its settings | Embedded script: OK (`embedded-script.html`, parameters `botId`/`embedType`). Dashboard page: **to do, #6**. |
| No "powered by" watermarks or ads shown to site visitors | **Blocker, #10.** The widget shows a "Powered by" credit in the chat panel. |
| Site identified by `instanceId`, signed instance verified server-side | OK. The settings page verifies Wix's signed `instance`; the App Removed webhook JWT is verified. |
| Don't force a login unless it is core; reopening from Manage Apps logs the user straight back in | OK. There is no Conferbot login in the app, only a bot ID. The demo bot works without an account. |
| Wix Billing for any charge collected through the app | Not applicable: free. |
| HTTPS, CSRF/XSS protection, minimal permissions (Manage Embedded Scripts only), webhooks return 200 | OK in code. HTTPS depends on hosting. |
| A privacy policy and terms of use, an active demo account kept alive while listed | URLs below. The reviewer needs no account (demo bot). |
| The site must be on a Premium plan with a connected domain for embedded scripts to run | A note in the listing and the test steps. |

Review: automated, with no published timeframe. Blockers come back immediately on submit.

## 3. Blockers

1. **#6**: move to Wix OAuth (client credentials and the AppInstalled webhook) and add a dashboard page extension.
2. **#10**: the "Powered by" credit in the widget versus the no-watermark rule.
3. **Hosting**: a public HTTPS `APP_URL` with a persistent database (`src/store.js` is a JSON file), plus the app ID, secret and webhook public key from the Dev Center.
4. A Premium Wix test site with a connected domain, for testing and screenshots.

## 4. Listing copy (ready to paste)

Wix rules: no "Wix" in the name or teaser, no company name in the teaser, title case, the teaser speaks to the user, at least 3 features, and the first 500 characters of the description are shown before "Read more", with no bullet points.

- **App name:** `Conferbot AI Chatbot`
- **Teaser:** `Answer visitors 24/7 with an AI chatbot and live chat, capture leads and hand over to your team.`
- **Description** (plain paragraphs, no bullets; the first 500 characters carry the pitch):

  > Add an AI chat assistant to every page of your site. It answers visitors' questions instantly, day and night, collects leads, and hands the conversation to a person on your team whenever someone needs one, with queue position, file sharing and a post-chat rating. When nobody is free, visitors leave a message.
  >
  > Setup takes a minute. Paste your Chatbot ID in the app's dashboard page and switch the chat on. The widget's look and behaviour (guided flows or an AI agent trained on your content, colours, logo, launcher, greetings and languages) are designed in your Conferbot dashboard and apply straight away.
  >
  > A Conferbot account is needed to run your own bot, and the free plan is enough to start. You can try the widget with a demo bot before signing up. The chat appears on published sites on a Premium plan with a connected domain.

- **Features:**
  1. AI chatbot that answers visitors 24/7
  2. Live chat handover to your team
  3. Lead capture built into the conversation
  4. One-minute setup with a single Chatbot ID
  5. Fully brandable widget
- **Search keywords:** `chatbot, live chat, ai chatbot, customer support, chat widget, helpdesk, lead generation`
- **Category:** Communication > *Chat* (primary). The closest alternative is *Customer Support*.
- **Pricing:** Free. Text: "Free app. A Conferbot account is required; a free plan is available (no card)."
- **Support email:** `support@conferbot.com` (the address on the app's settings page and on conferbot.com/contact)
- **Privacy policy:** https://www.conferbot.com/privacy-policy (HTTP 200). **Terms of use:** https://www.conferbot.com/terms-of-service (HTTP 200)
- **Demo site URL:** optional. Leave it blank, or set up a Premium demo site after hosting.

### Data and GDPR statement

This statement matches `src/server.js`, `src/store.js` and `embedded-script.html`.

- **The app server stores** only, per site (`instanceId`): the Wix access and refresh tokens and the settings (bot ID, switch, embed type). The App Removed webhook deletes the record and tokens. #6 removes the stored refresh token.
- **Permission:** Manage Embedded Scripts only. The app reads no site members, contacts or orders.
- **What the site sends:** Wix renders the embedded script, and the visitor's browser loads `https://cdn.conferbot.com/dist/v1/widget.min.js`. The script passes only the Chatbot ID, the embed type and `platform: "wix"`. No visitor or member identity comes from the app.
- Whatever the visitor types or uploads in the chat goes to Conferbot as the conversation.
- The app sets no cookies of its own. The widget's storage is described in the Conferbot privacy policy and should follow the site's cookie consent.

## 5. Reviewer test instructions (once hosted and #6 is done)

> 1. Add the app to a Premium test site with a connected domain. It installs through Wix OAuth without asking you to log in.
> 2. Open it from Apps > Manage Apps > Conferbot (the dashboard page).
> 3. Click "Try our demo bot", or paste the public demo Chatbot ID `691c970890527a0468f9b2c9` (a live "Startup Consultation Chatbot"; no Conferbot account needed). Turn the chat on and save.
> 4. Publish the site and open the live domain. A chat bubble appears bottom right. Click it and reply to the bot. (The editor preview does not run embedded scripts.)
> 5. Remove the app: the script leaves the site, and the App Removed webhook deletes the site's record.

## 6. Assets (in `docs/marketplace/assets/`)

| File | Size | Content |
| --- | --- | --- |
| `app-icon-1000x1000.png` | 1000x1000 | Conferbot logo (from the landing site), no text; Wix rounds it into a squircle |
| `image-1-promo-1200x900.png` | 1200x900 (4:3) | Main image: app name, tagline, and the real widget panel |
| `image-2-settings-1200x900.png` | 1200x900 | The app's real settings page after saving (from the e2e recording) |

**Still needed** (Wix recommends 5–6 images): 2 of the widget on a real Wix template, 1 of the mobile view, and 1 of the dashboard page once #6 is done. Capture them on the Premium test site. The storefront in `docs/demo.gif` is a mock and must not be used. A promo banner (540x360 JPG, no text or logo) and a YouTube video are optional.

## 7. Owner checklist

- [ ] Decide on #6 (OAuth and dashboard page) and #10 (the "Powered by" credit), then release 0.2.0.
- [ ] Host the app and fill `WIX_APP_ID`, `WIX_APP_SECRET`, `WIX_PUBLIC_KEY`, `APP_URL`.
- [ ] Dev Center: company info, app extensions (embedded script, dashboard page), permissions, webhooks, and the listing copy above.
- [ ] Premium test site with a connected domain: install, capture the remaining images.
- [ ] Submit & Publish. Fix any blockers the automated review lists, or appeal through support.

Owner time: about half a day after #6 and #10 (hosting, test site, images, listing). Review: automated, immediate to days. Fees: none.

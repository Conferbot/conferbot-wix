# Changelog

## 0.1.0 - 2026-10-17

First tagged version of the Conferbot Wix app (Express, OAuth). Not yet listed on the Wix App Market.

- Installer flow, settings page and embedded script parameters pushed to the site.
- OAuth: state and instance are verified and the install finishes on the installer close window; the access token's instance is looked up; expired access tokens are refreshed.
- Settings open and save only for the site admin, through signed, short-lived tokens; stale, undated or other-app Wix instance tokens are refused.
- Only the Wix dashboard may frame the settings page.
- The widget does not boot while the chat is switched off.
- Webhooks: Wix webhook JWTs are verified with the app public key (`WIX_PUBLIC_KEY`); App Removed deletes the site record.
- Bot ID help points to Share > Embed into your website in the Conferbot dashboard.

# Changelog

## 0.2.0 - 2026-10-17

Wix OAuth and the dashboard page (#6). Not yet listed on the Wix App Market (#10 is still open).

- Authentication moved from the deprecated custom authentication to Wix OAuth with client credentials: an access token is created per site with the app ID, the app secret and the `instanceId` (`POST /oauth2/token`), kept in memory, and replaced once if Wix refuses it. No installer redirect, authorization code or refresh token; `/auth/start` and `/auth/callback` are gone, and `WIX_INSTALLER_BASE` is no longer used.
- The App Instance Installed webhook creates the site's record (switched off). A duplicated site copies the original site's settings and embeds them.
- The settings page is the app's dashboard page (`{APP_URL}/app`, opened by Wix with a signed `instance`). It also starts the site's record if the install webhook never arrived.
- No Wix tokens are stored any more. Sites installed with 0.1.0 have their stored tokens removed on the next save or install event.
- App Instance Removed also forgets the site's cached token.

## 0.1.0 - 2026-10-17

First tagged version of the Conferbot Wix app (Express, OAuth). Not yet listed on the Wix App Market.

- Installer flow, settings page and embedded script parameters pushed to the site.
- OAuth: state and instance are verified and the install finishes on the installer close window; the access token's instance is looked up; expired access tokens are refreshed.
- Settings open and save only for the site admin, through signed, short-lived tokens; stale, undated or other-app Wix instance tokens are refused.
- Only the Wix dashboard may frame the settings page.
- The widget does not boot while the chat is switched off.
- Webhooks: Wix webhook JWTs are verified with the app public key (`WIX_PUBLIC_KEY`); App Removed deletes the site record.
- Bot ID help points to Share > Embed into your website in the Conferbot dashboard.

# Relay as an installable web app

Relay now has a web app manifest, branded 192/512-pixel PNG icons, a separate maskable icon, an Apple touch icon, standalone display metadata, install controls and a production service worker.

## Install and launch

- **Chrome / Edge desktop and supported Android browsers:** when the browser emits its installability event, **Install App** appears in the sign-in page or workspace header. Clicking it opens the browser's own install confirmation. It is consumed once; accepting or dismissing it clears that prompt. The browser decides when another offer is available.
- **iPhone / iPad:** **Install App** opens accessible instructions for Share → Add to Home Screen. Keep Open as Web App enabled if offered. Safari is the fallback if the current browser lacks that menu option.
- **Safari on supported macOS versions:** use the browser's File → Add to Dock flow. Safari does not expose the Chromium install-prompt event.
- Browsers without a supported installation flow continue to work as a website. No fake native prompt is shown.
- Launch Relay from its installed icon. The manifest requests `display: standalone`, so in-scope app pages open in their own window without normal browser tabs/address bars. External URLs remain subject to browser security UI.

Controls are hidden inside an installed standalone window or the existing Electron shell, and after the browser's appinstalled event. A regular iOS browser tab cannot reliably know whether another Home Screen copy already exists.

**Deploy on HTTPS for phones and public desktop access.** HTTP localhost / 127.0.0.1 is permitted for same-device development. A phone's 127.0.0.1 refers to the phone, not the development computer. Public HTTPS hosting is still required before claiming a mobile production installation.

## Offline and updates

The worker is registered only in production, on a secure origin. It caches exactly the public offline page and five public icon files. It does not cache application HTML, message history, API responses, Auth pages, signed file URLs, uploads, or Supabase traffic. API/Auth and non-GET requests pass directly to the network.

If an in-scope navigation fails offline after a successful initial visit, the branded offline screen offers **Try again**. Conversations still require connectivity. This feature does not introduce an offline message outbox or offline access to private records.

A new worker waits while an existing app window is open. An update notice offers **Reload** or **Update later**. The worker activates immediately only after Reload is chosen; controllerchange then reloads the app. Otherwise it activates normally when the old windows close. It does not force a mid-conversation reload.

Change the `relay-public-v1` cache version in `public/sw.js` when changing the precached public assets. Activation removes only older caches with Relay's public-cache prefix.

## Running and deploying

```powershell
npm run build
npm run prepare:standalone
$env:HOSTNAME='127.0.0.1'
$env:PORT='3000'
node --env-file=.env.local .next/standalone/server.js
```

The preparation script copies `public/` and `.next/static/` into the standalone output. They are required for the service worker and icons. Vercel serves public assets automatically; Docker already copies public assets. Do not serve a stale public folder with a fresh build.

`/sw.js` has JavaScript content type, root-scope permission and no-store/revalidation headers. The manifest and public PWA files bypass the Auth-refresh proxy. Existing Auth checks and RLS continue to protect app/API requests.

Regenerate the icon variants from the existing Relay vector:

```powershell
node scripts/generate-pwa-icons.mjs
```

## Verification

`npm run test:pwa` runs a separate production-only Edge suite on port 3011. It verifies the served manifest/icons/headers, accepted/dismissed/rejected browser-event handling, mobile instructions and focus restoration, standalone/native-shell suppression, actual service-worker offline fallback, exclusion of private paths from caches, and user-controlled update activation. Native installation events, iOS platform detection and the waiting-worker UI are simulated where noted in the test; real Cache Storage and offline navigation are exercised.

These checks do not install an OS application or prove a real iPhone/Safari installation. Device installation remains a manual release check on the final HTTPS origin. The existing database and authenticated collaboration validation limits still apply.

References: [MDN installability](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable), [install prompts](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Trigger_install_prompt), [standalone display](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Create_a_standalone_app), [WebKit Home Screen apps](https://webkit.org/blog/13878/).

Development-suite limitation observed during this change: the default webpack development server intermittently returned a startup/script parse failure (15/16 local checks passed in the latest full run, five authenticated journeys skipped). Changing test concurrency/origin did not resolve it; those exploratory configuration changes were reverted. Isolated development loads passed, and all eleven production PWA tests pass. This is recorded as an unresolved development-mode concern rather than a passed full regression run.

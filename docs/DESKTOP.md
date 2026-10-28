# Relay for Windows

## Current delivery state

The Electron desktop source and an **unsigned Windows x64 validation installer** are included. The native shell has been run in a hidden smoke test. This is not a production desktop release: the installed validation build intentionally opens a deployment-required screen until a verified HTTPS Relay application origin is compiled into its configuration. It does not contain example conversations or a substitute messaging backend.

Artifact: `desktop/release/Relay-Setup-0.1.0-x64.exe`. This installer has not been installed on the user's Windows account during development; doing so would create shortcuts and protocol registrations. The packaged application is smoke-tested separately without installation.

## Architecture and native features

- Electron 45.1.0, electron-builder 26.18.0, electron-updater 6.8.11, pinned with an independent lockfile.
- Loads only the configured Relay HTTPS origin into its primary renderer. It shares Supabase Auth, database, Storage, Realtime and RLS with the web application. File inputs use the native picker.
- Sandboxed renderer, context isolation, Node integration disabled, web security enabled, no webview or child windows. External HTTPS links require a native confirmation and then open in the system browser.
- Every IPC request validates both the sending WebContents and its main frame's exact origin. The bridge exposes notifications, startup preference, version and update actions, with no filesystem, shell or arbitrary IPC access.
- Main window closes to the tray. Tray and application menu restore or quit it; the Relay menu controls launch at sign in. Standard editing, reload, zoom and full-screen shortcuts are native; `Ctrl+Q` quits. Messaging shortcuts remain shared with the web application.
- `relay://open?workspace=<uuid>&conversation=<uuid>&message=<uuid>` navigates to the same fixed origin with those query parameters. Unknown fields cannot change the origin or inject authentication codes. The server/database still authorizes every requested resource.
- Native notifications accept at most 120 characters of title and 500 of body, are suppressed while focused, and are capped at 12 per minute. A click opens a constrained internal path. The web application must apply its notification preferences before requesting the notification.
- Download filenames are sanitized; Windows reserved device names are rejected. Downloads require a trusted application/storage URL chain and show the normal Save dialog. Downloads are never executed automatically.
- Credentials are not copied into renderer localStorage on disk. The renderer uses an in-memory session. Only Supabase session cookies for the trusted application origin are persisted in `credentials.bin`, encrypted through Electron's asynchronous safeStorage API (Windows DPAPI). Logout removes the vault. Encryption unavailability leaves the session in memory; there is no plaintext fallback. DPAPI does not protect against other applications running as the same Windows user.
- Updates use an HTTPS generic feed and code-signature verification. Checks and downloads are user-initiated from the Relay menu. Installation requires a verified downloaded update. Downgrades and installation on ordinary quit are disabled.

## Local development

From `desktop/`:

```powershell
npm ci --ignore-scripts
node node_modules/electron/install.js
npm test
$env:RELAY_APP_URL = 'http://localhost:3000'
npm start
```

Start the configured Next.js server separately. `RELAY_APP_URL` is honored only by an unpackaged development runtime, and HTTP is accepted only for localhost/loopback. No environment variable can override the compiled production origin in a packaged application.

`node scripts/smoke.cjs` starts a hidden development shell, checks isolation and a native credential-encryption round trip, writes `desktop/release/smoke.json`, and exits. Its user data stays inside `desktop/release/smoke-user-data/`.

## Validation installer

```powershell
npm run build:validation
```

This builds NSIS x64 without publishing, with signing explicitly disabled. Windows may display an unknown-publisher/SmartScreen warning because it is unsigned. Do not distribute it as the production application. `npm run pack` builds the unpacked directory for native QA.

## Production build and release

1. Complete the web release gates in the main project documentation: authenticated production messaging, tested RLS, HTTPS origin, auth redirect URLs, SMTP, monitoring, backups, and load tests.
2. Set `desktop/config.json` before packaging. `appUrl` is the exact deployed HTTPS origin with no path, query, credentials or fragment. If attachments download directly from Supabase, set `storageUrl` to that Supabase HTTPS origin. These values are public addresses, never API secrets.
3. Set `updateUrl` to an HTTPS generic update-feed directory and `publisherName` to the exact Windows code-signing certificate publisher.
4. Store `CSC_LINK` (or `WIN_CSC_LINK`) and its password in CI secrets. Do not place a certificate or password in this repository. The release script enables executable signing and metadata editing and passes the expected publisher to electron-builder. The publisher is embedded in update configuration for signature verification.
5. Increase `desktop/package.json` version for every release; run `npm ci --ignore-scripts`, install the pinned Electron binary, `npm test`, and `npm run build`. The production build refuses to run with an unset origin, unsigned update configuration, or absent signing-certificate reference.
6. Test the signed installer in a disposable Windows VM: install/uninstall, authenticate two real users, send messages, upload/download, notifications with DND, startup opt-in, close/restore tray, revoked access, session persistence and logout, deep links, offline recovery, and an update from the previous signed version. Do not silently install into a developer's primary Windows account.
7. Publish the generated signed installer, matching `.blockmap`, and `latest.yml` to the configured feed. Preserve HTTPS and immutable versioned installer files. Verify the release signature with `Get-AuthenticodeSignature` and verify the published hashes. Test publisher mismatch, altered installer and downgrade rejection before enabling updates for users.

Example public configuration:

```json
{
  "appUrl": "https://your-verified-relay-domain.example",
  "storageUrl": "https://your-project.supabase.co",
  "updateUrl": "https://your-release-host.example/relay/",
  "publisherName": "Your legal certificate publisher"
}
```

These example domains are documentation only; the default shipped configuration is unconfigured.

## Verification performed

- Eight Node tests passed for production-origin validation, deep-link origin restrictions, notification path validation, IPC sender/main-frame checks, filename restrictions, cross-origin/expired credential rejection, logout vault deletion, and no plaintext fallback.
- Hidden Electron smoke passed: renderer sandbox and context isolation enabled, Node integration disabled, `window.require` and `window.process` undefined, Windows safeStorage encryption available, encrypt/decrypt round trip passed.
- Runtime dependency audit returned zero known vulnerabilities on 2026-10-28. An audit result is not a full security review.
- NSIS validation installer packaging completed successfully. A subsequent rebuild includes final source changes; check `desktop/release/build-result.json` for the latest recorded artifact/hash and packaged smoke result.

Unverified/release-blocked: signed production installation, real hosted authenticated desktop workflows, tray/startup behavior after installation, OS notification delivery on all Windows settings, update feed/signature recovery, SmartScreen reputation, Windows accessibility review, and multi-machine release qualification.

## References inspected

- https://www.electronjs.org/docs/latest/tutorial/security
- https://www.electronjs.org/docs/latest/api/safe-storage
- https://www.electronjs.org/docs/latest/api/session
- https://github.com/electron-userland/electron-builder

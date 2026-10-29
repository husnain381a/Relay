# Relay

A Slack-inspired team messenger built with Next.js, TypeScript, Supabase and an installable PWA. Original visual identity; no voice/video/screen sharing. Production code contains no sample accounts, workspaces or messages.

**Status: connected to the dedicated Relay backend; not production released.** All eight migrations are applied to **relay-web** in the **Relay** organization, and the local app is configured. The production build and hosted public-key/authorization smoke checks pass. Dashboard Realtime public-channel access must still be disabled and Auth callback URLs verified; authenticated collaboration, SMTP, hosting and signed desktop qualification remain pending. See [backend configuration](docs/BACKEND.md) and [feature status](docs/STATUS.md).

## Run the web application

Prerequisites: Node.js 24 LTS (22+ supported), npm, a **dedicated** Supabase project. Docker is needed only for the full local Supabase stack, not the bundled SQL test harness.

```powershell
cd outputs/relay
npm ci
Copy-Item .env.example .env.local
```

Set these in `.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Never put secret/service-role keys in `NEXT_PUBLIC_*`. `.env.local` is ignored by Git. The app shows an explicit setup screen until configured.

Apply **every** SQL file under `supabase/migrations/`, in filename order, to the dedicated project using Supabase migrations or the SQL Editor. The migrations create tables, RLS, secure RPCs, account profile trigger, private storage bucket and real-time authorization. They do not create test users or seed application content. See [database notes](docs/DATABASE.md).

In Supabase:

1. Set Auth Site URL to `http://localhost:3000` for development and allow the corresponding `/auth/callback` and `/auth/confirm` URLs. Use the deployed HTTPS origin for production.
2. Enable email/password authentication, email confirmation, and production SMTP. Do not disable confirmation to work around email delivery problems. For token-hash confirmation emails, follow [deployment instructions](docs/DEPLOYMENT.md).
3. Disable **Allow public access** in Realtime settings. Relay subscribes only to private topics.
4. Keep the `attachments` bucket private. Its policies are installed by the migration.

```powershell
npm run dev
```

Open `http://127.0.0.1:3000`, create and confirm your account, create a workspace, then create channels or invite teammates. If you use this hostname, include it in Auth redirect allowlists and set the matching app URL. Sign-in and all collaboration operations require the real backend.

## Verify

Relay also supports browser installation with a standalone app window, an **Install App** control in supporting browsers, iPhone/iPad Home Screen guidance, and a privacy-preserving offline screen. See [PWA setup and verification](docs/PWA.md). Public mobile installation requires an HTTPS deployment.

```powershell
npm run typecheck
npm test
npm run test:db
npm run build
npm run test:e2e
```

The SQL suite runs real PostgreSQL through PGlite, with minimal Auth/Storage/Realtime schema shims. It does **not** run GoTrue, the object-storage HTTP service or real sockets. The default browser suite tests the honest unconfigured app at desktop/mobile sizes. Separate real-backend tests are gated on explicit credentials and test-write authorization. See [test instructions and limits](docs/TESTING.md).

Webpack is selected explicitly because Turbopack’s PostCSS worker failed inside this Windows execution sandbox. The webpack production build passes; this does not change application architecture.

## Scheduled messages

Persisting a scheduled message and dispatching it are separate operations. Configure an actual scheduler to call `/api/cron/scheduled` with `Authorization: Bearer <CRON_SECRET>` once per minute, or configure a database-owned pg_cron job as described in deployment notes. The HTTP dispatcher requires a random `CRON_SECRET` of at least 32 characters and a server-only `SUPABASE_SECRET_KEY`. Neither is required for normal messaging. A scheduled message is **not promised to send automatically** until the dispatcher is deployed and verified. Failed dispatches remain visible in Later with a reason and cancellation action.

## Release focus and security

This release targets the web application and installable PWA. Native EXE packaging and publication are deferred; the historical desktop source remains for reference. No EXE or signing credential is included in Git, and desktop build jobs are disabled.

Read [SECURITY.md](SECURITY.md) for verified access controls, encryption boundaries and the remaining hosted security settings. Messages are not end-to-end encrypted. Run `npm run security:repo` to inspect Git history and staged files for credential/installer patterns.

## Repository map

| Path | Purpose |
| --- | --- |
| `src/app` | App Router pages, auth callbacks, verified API endpoints, health/dispatcher |
| `src/components` | Workspace shell, auth, conversation, virtual list, composer, threads, search, settings |
| `src/lib` | Shared validation/types, Supabase clients, data services, reconciliation, trusted presence |
| `supabase/migrations` | Canonical schema, RLS, authorized RPCs, storage and real-time policies |
| `tests` | Unit/service-boundary, public browser and gated real-backend tests |
| `scripts` | Actual SQL security tests and explicitly gated load test |
| `desktop` | Archived native source; outside the current web/PWA release |
| `docs` | Architecture, feature status, database, testing, deployment and operations |

## Product behavior

Channels and DMs share one conversation model. A send is persisted under a client UUID; Retry reuses that ID. Database sequence cursors order history, while private identifier-only broadcasts invalidate authorized reads. Reconnect catches up in keyset pages and re-fetches previously visible messages for offline edits/deletions. Typing/presence identities and timestamps come from authenticated database RPCs; browser heartbeats refresh their expiry. Message bodies render Markdown without raw HTML or external image embeds. Files use private storage and 60-second signed access.

The UI includes compact workspace/channel navigation, thread drawer, light/dark/system appearance, a visual rich-text editor with Markdown source/preview, emoji reactions, mentions, file uploads with retry, search filters, durable text drafts, paginated saved/scheduled messages and followed threads, notifications, profiles, roles, invitations, channel management and audit display. For exact testing status and outstanding scope (including richer editor behavior, scale validation and release access), consult [STATUS.md](docs/STATUS.md).

## Skills and third-party inspection

The requested `skills` CLI (1.7.4) and `claude-code-templates` (1.30.0) sources/package metadata were inspected before running. `find-skills` and the full-stack agent template were installed project-locally. Claude Code itself is not installed; native Codex agents performed the implementation using compatible full-stack guidance. UI UX Pro Max and the official Supabase/Postgres skills were already available, so no duplicate global installs were needed. Dependency versions are exact and lockfiles are included. Full source references and decisions are in [ARCHITECTURE.md](docs/ARCHITECTURE.md).

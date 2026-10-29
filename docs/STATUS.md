# Relay delivery status

Updated 2026-10-29 (Asia/Karachi). **The app is connected to the dedicated Relay backend; production release is not complete.** Eight migrations are applied to relay-web (qiidmrxekvdqjfeoqhgt), local public configuration is saved, and the configured production build passes. Hosted Auth/public-key and anonymous authorization checks pass. See [BACKEND.md](BACKEND.md) for the remaining dashboard settings and exact evidence. Vercel remains unconnected.

## Verified results

| Check | Result |
| --- | --- |
| TypeScript / production build | Pass; Next.js 16.4.3 webpack |
| Unit/service tests | 104 pass across 13 files |
| Database | 45 authorization/persistence groups pass across all 8 migrations in PGlite PostgreSQL |
| Production PWA | 11 Edge checks pass, including 375/768/1440px layouts, install events, metadata, real offline worker and cache privacy |
| Development browser suite | Latest full run: 15 pass, 1 intermittent startup failure; five hosted journeys skipped. Dev server logged JSON parsing errors; production PWA checks pass. |
| Hosted connectivity | 5 public-key checks pass: Auth health/settings, anonymous table/RPC/private-channel denial; public channels still allowed |
| Hosted collaboration | 5 authenticated collaboration tests remain unrun; no real-user passes claimed |
| Dependency audit | Zero known web production/development vulnerabilities at final audit |
| Desktop | 8 security/vault tests pass; packaged sandbox/isolation/DPAPI smoke passed |
| Installer | Native EXE releases deferred by user; no installer committed or published |
| Infrastructure | CI/Docker/deployment configuration supplied; remote CI/container/cloud deployment not run |

PGlite executes actual application SQL, constraints, roles and RLS with Supabase-owned platform interfaces shimmed. Browser editor/image tests use explicitly development-gated fixtures without a backend. Neither proves hosted Auth/Storage/WebSocket behavior. Fixture routes return 404 in production.

## Implemented

- Installable PWA: standalone manifest, branded/maskable/Apple icons, browser-triggered Install App control, iPhone/iPad instructions, production worker with public-only offline fallback and user-controlled updates. Eleven production Edge checks pass; real OS/iOS installation on a deployed HTTPS origin remains unverified. See [PWA.md](PWA.md).

- Original responsive communication shell, workspace/channel rail, conversation and thread panels, search, light/dark/system themes, dialogs, shortcuts and recovery states.
- Supabase signup/signin/confirmation/password recovery, verified SSR sessions and session controls.
- Multiple workspaces, private logos, secure invitations/revocation, roles/members, ownership transfer/leave and audit display.
- Public/private channels, topics/descriptions, archive/delete/join/leave/member management/pins/preferences; one-to-one/group DMs with participant isolation and pair deduplication.
- Persisted optimistic messages, UUID retries, sequence/cursor history, virtualization, reconnection reconciliation, edits/deletes/reactions, saved items, links and text forwarding.
- Tiptap visual editor plus Markdown source/preview, user/channel pickers, emoji, drag/drop files, upload retry and durable user-isolated text drafts.
- Independent thread cursors/unread counts, participants, explicit follow/unfollow, follower/mention notifications and paginated Threads collection.
- Private identifier-only realtime, authenticated presence/typing and versioned topic rotation on membership revocation; stale asynchronous connection callbacks cannot commit.
- Authorized indexed message search and filters, channel/user/file search, paginated collections and full saved-ID hydration.
- Private attachments and signed previews/downloads, private photo/logo preparation/upload/removal, profile/status/DND/notification/account settings.
- Scheduled-message persistence, service-only dispatcher, visible failures and cancellation. Automatic dispatch requires an actual deployed scheduler.
- RLS, independently authorized RPCs, hashed invitations, input/stream limits, origin checks, safe rendering, rate limiting, private storage and audit logs.
- Electron sandbox/isolation, constrained native bridge, tray/startup, deep links/downloads/shortcuts, encrypted credentials and guarded updater.

## Remaining release work and limits

1. Disable public Realtime access, verify Auth callback URLs, configure SMTP and run the actual multi-user/Storage/socket suite. The dedicated project, all eight migrations, private buckets, local connection and hosted advisors are complete.
2. Connect hosting, deploy and verify real workflows. Enable scheduler/monitoring/backups/retention. Logs and health checks exist; Sentry SDK/alert delivery remains unimplemented.
3. Measure concurrency, query plans, accessibility and devices with real records. Latency/load budgets are targets, not achieved SLOs. Large histories need bounded thread-summary profiling.
4. Configure aggregate storage quotas and orphan/retention automation; per-file limits and own-image cleanup already exist. Run restore drills.
Native EXE builds are deferred and are no longer a release gate for this web/PWA scope. Historical desktop source/evidence is retained.

Additional limits: editor formatting follows its enabled schema; pending File objects remain page-local. Draft sync is debounced and last-write-wins across devices; unchanged retries preserve IDs within the browser session. Text forwarding does not copy original attachments. The emoji set is curated. Channel/user search uses loaded authorized workspace records. Optional email notifications are absent. Presence is conversation-scoped and multi-tab closing can transiently clear presence.

Session revocation may leave existing access tokens valid until expiry. RLS revokes tenant reads immediately; versioned topics stop future activity on old topics after removal, with hosted timing still unverified. Issued signed URLs remain valid for their 60-second TTL; downloaded content cannot be recalled.

See README.md and docs/{DATABASE,TESTING,DEPLOYMENT,OPERATIONS,MEDIA,DESKTOP}.md for setup and exact boundaries. No local check is presented as a production-ready service guarantee.

Latest security review: see ../SECURITY.md. Hosted RLS/private-storage/anonymous-denial checks pass. Public Realtime remains enabled and the advisor reports leaked-password protection disabled; no paid upgrade or Auth setting change was performed.

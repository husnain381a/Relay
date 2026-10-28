# Relay delivery status

Updated 2026-10-29 (Asia/Karachi). **The local build is ready for handoff; production release is not complete.** The dedicated Supabase URL/key have not been supplied, Vercel is not connected, and no existing project was modified. Supabase rejected the approved free project's creation because of its active-project quota.

## Verified results

| Check | Result |
| --- | --- |
| TypeScript / production build | Pass; Next.js 16.4.3 webpack |
| Unit/service tests | 98 pass across 12 files |
| Database | 45 authorization/persistence groups pass across all 7 migrations in PGlite PostgreSQL |
| Browser | 16 Edge checks pass: setup/responsiveness/contrast/keyboard, rich editor/Markdown/paste/retry IDs, actual raster decoding/resize/preview/rejection |
| Hosted collaboration | 5 real-backend tests explicitly skipped without credentials; zero cloud passes claimed |
| Dependency audit | Zero known web production/development vulnerabilities at final audit |
| Desktop | 8 security/vault tests pass; packaged sandbox/isolation/DPAPI smoke passed |
| Installer | Unsigned x64 NSIS validation installer built; signing and clean-machine installation still pending |
| Infrastructure | CI/Docker/deployment configuration supplied; remote CI/container/cloud deployment not run |

PGlite executes actual application SQL, constraints, roles and RLS with Supabase-owned platform interfaces shimmed. Browser editor/image tests use explicitly development-gated fixtures without a backend. Neither proves hosted Auth/Storage/WebSocket behavior. Fixture routes return 404 in production.

## Implemented

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

1. Supply and authorize the dedicated Supabase project; apply all seven migrations, configure private Realtime/Auth redirects/SMTP, run cloud advisors and the actual multi-user/Storage/socket suite.
2. Connect hosting, deploy and verify real workflows. Enable scheduler/monitoring/backups/retention. Logs and health checks exist; Sentry SDK/alert delivery remains unimplemented.
3. Measure concurrency, query plans, accessibility and devices with real records. Latency/load budgets are targets, not achieved SLOs. Large histories need bounded thread-summary profiling.
4. Configure aggregate storage quotas and orphan/retention automation; per-file limits and own-image cleanup already exist. Run restore drills.
5. Pin the deployed HTTPS origin in desktop, provide signing/update credentials, rebuild and verify clean-machine installation and signed updates.

Additional limits: editor formatting follows its enabled schema; pending File objects remain page-local. Draft sync is debounced and last-write-wins across devices; unchanged retries preserve IDs within the browser session. Text forwarding does not copy original attachments. The emoji set is curated. Channel/user search uses loaded authorized workspace records. Optional email notifications are absent. Presence is conversation-scoped and multi-tab closing can transiently clear presence.

Session revocation may leave existing access tokens valid until expiry. RLS revokes tenant reads immediately; versioned topics stop future activity on old topics after removal, with hosted timing still unverified. Issued signed URLs remain valid for their 60-second TTL; downloaded content cannot be recalled.

See README.md and docs/{DATABASE,TESTING,DEPLOYMENT,OPERATIONS,MEDIA,DESKTOP}.md for setup and exact boundaries. No local check is presented as a production-ready service guarantee.

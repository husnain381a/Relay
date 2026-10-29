# Relay database and authorization

## Implementation and verification state

Eight CLI-generated migrations create and extend the product:

- `20261028145621_relay_initial.sql`: product schema, indexes, constraints, RLS, attachments, RPCs, notifications and private Broadcast authorization.
- `20261028150906_authenticated_presence.sql`: server-authenticated presence and removal of peer Broadcast/Presence writes.
- `20261028151406_unread_counts.sql`: recipient-scoped unread aggregation independent of notification-list pagination.
- `20261028192954_thread_subscriptions.sql`: follows, independent thread read cursors, thread summaries, subscribed-thread pagination and targeted thread notifications.
- `20261028193207_durable_drafts.sql`: private durable main-conversation/thread drafts.
- `20261028193249_private_profile_media.sql`: private uploaded avatars and workspace logos with authorized reference changes and cleanup.

They contain no sample users or messages. Thread subscription backfill uses existing authored records only.

`node scripts/test-database.mjs` executes all eight complete migrations in PGlite (real PostgreSQL compiled to WASM), with compatibility shims only for Supabase-owned Auth, Storage and Realtime schemas. It runs 45 groups of positive and adversarial assertions. This validates PostgreSQL semantics, roles, grants, RLS and application SQL; it does **not** prove hosted Supabase Auth, Storage MIME enforcement, replication, WebSocket subscriptions, production concurrency, latency or backups.

All eight migrations are applied to the dedicated relay-web project in the Relay organization. Hosted advisors, all-table RLS and private bucket configuration were checked. Public-key Auth and anonymous denial checks pass; authenticated multi-user workflows remain unverified. See BACKEND.md for the exact project and pending dashboard configuration.

## Core model

| Relation | Purpose and access rule |
| --- | --- |
| profiles | One row per Auth user; self and shared-workspace profiles visible; own presentation fields editable |
| workspaces / workspace_members | Tenant boundary; only members read; owner/admin/member roles stored in trusted rows |
| conversations / conversation_members | Public/private channels and DMs; workspace membership required; private/DM participation required |
| messages | Persisted text/Markdown, identity sequence, top-level threads, soft deletion; access inherited from conversation |
| reactions / pins | Reactions and channel pinning; accessible messages only, caller's own reactions |
| saved_messages | Caller-only saved items, still subject to current message access |
| attachments | Private stored objects linked to caller-authored, accessible messages; 10 MiB limit |
| invitations | SHA-256 token hash, expiry, use limit; owner/admin management; clear token returned once |
| notifications | Recipient-only identifiers, current conversation access required; only own read timestamp update allowed |
| scheduled_messages | Caller-owned scheduled sends; service-only dispatch revalidates access; failed sends retain error |
| audit_logs | Administrative action trail, visible to workspace owner/admin |
| private.rate_limits | Atomic per-user, per-minute mutation limits; no client table grants |
| conversation_presence | Server-authenticated identity and timestamps, current conversation access, 60-second heartbeat expiry |
| thread_subscriptions | Caller-owned follow preferences, explicit-unfollow state and independent monotonic thread read cursors |
| message_drafts | Caller-only durable draft text for a writable conversation or live top-level thread |

All public product tables enable RLS. Direct client mutation grants are narrowly limited to own profile fields, notification read timestamps, pending schedule cancellation, and validated attachment metadata insertion/removal. Messages, workspace roles, membership, invitation acceptance and channel changes require RPCs.

## RPC boundary

Public RPCs are `SECURITY INVOKER` wrappers. Privileged operations run in the non-exposed `private` schema, use an empty `search_path`, validate `auth.uid()` and each affected resource, and have explicit EXECUTE grants. Helper functions avoid recursive RLS when checking memberships. Anonymous users receive no product table access and cannot invoke application mutations. Profile metadata supplies display names only; it is never used for roles or authorization.

RPCs beyond the original contract: `reply_counts`, `unread_counts`, `set_presence`, `clear_presence`, `follow_thread`, `mark_thread_read`, `thread_summaries`, `subscribed_threads`, `unread_thread_counts`, `save_draft`, `clear_draft`, `set_avatar`, `set_workspace_logo`, `delete_conversation`, `remove_conversation_member`, `revoke_invite`, `transfer_ownership`, and service-only `process_scheduled_messages` (alias `dispatch_scheduled_messages`).

- Messages: `send_message`, `edit_message`, `delete_message`, `toggle_reaction`, `toggle_saved`, `pin_message`, `mark_read`, `search_messages`, `reply_counts`.
- Workspaces: `create_workspace`, `update_workspace`, `create_invite`, `accept_invite`, `revoke_invite`, `set_member_role`, `remove_member`, `transfer_ownership`.
- Conversations: `create_conversation`, `update_conversation`, `delete_conversation`, `join_conversation`, `leave_conversation`, `add_conversation_member`, `remove_conversation_member`, `set_notification_preference`.
- Scheduling: `schedule_message`; dispatch is executable only by `service_role` through a server-held secret.

One-to-one DMs reuse an existing exact participant pair under an advisory transaction lock. Group DMs remain distinct conversations. Owner transfer locks the workspace and preserves one owner; an owner cannot simply leave or be removed. Public channels can be read by all workspace members, while participation controls channel notifications and read cursors. Joining/leaving a public channel does not change workspace-level authorization to its history.

## Persistence, ordering and recovery

The client supplies a UUID when sending. Retrying that ID with the same author, conversation, text and parent returns the persisted row. Conflicting reuse fails rather than overwriting data. A global bigint identity `seq` supplies stable sort and cursor pagination keys; identity sequences can have gaps and sequence allocation is not a guarantee of transaction commit order.

Database mutations and notification rows commit atomically. Database-triggered Broadcast sends invalidations, never message bodies. Reconnects and invalidations re-read authorized persisted history, deduplicate by UUID and merge by sequence. Broadcast is an acceleration signal; PostgreSQL remains authoritative. An acknowledgement means the database accepted the message, not that every peer viewed it.

Read cursors are monotonic and bounded to persisted history. An unchanged read cursor does not issue an UPDATE, preventing feedback loops through Realtime.

`unread_counts(p_workspace_id)` aggregates the caller's unread notification records through RLS without the inbox's 100-record display limit. These counts reflect notification preferences: muted/non-notifying messages do not increment them. Opening a channel clears only top-level message notifications. Thread replies retain unread status until that thread is read or an individual notification is acknowledged.

## Thread subscriptions and independent reads

`follow_thread(p_thread_id,p_following)` and `mark_thread_read(p_thread_id,p_seq)` validate that the target is an accessible, nondeleted top-level message. Nested replies cannot masquerade as thread roots. Root/reply authors follow automatically; explicit unfollow survives later author replies. Viewing a thread can record its read cursor without following it. The internal `explicitly_unfollowed` flag distinguishes that read-only state from a deliberate unfollow.

Thread cursors are server-clamped to persisted reply sequence values and never regress. `mark_thread_read` acknowledges only notifications for replies in that root up to the cursor. It cannot acknowledge another user's alerts or unrelated threads.

`thread_summaries(p_conversation_id)` returns a JSON map keyed by root message ID: `reply_count`, `last_reply_seq`, `last_reply_at`, `unread_count`, `following`, and authorized participant profiles. Deleted roots/replies are excluded from their respective aggregates. Unread replies exclude the caller's own messages and are tracked only for followed threads. `unread_thread_counts(p_workspace_id)` aggregates those unread replies by conversation without inbox pagination limits. This measures followed-thread reading independently of notification delivery preferences.

`subscribed_threads(p_workspace_id,p_limit,p_offset)` returns root message records for followed threads with live replies, ordered by newest reply. The limit is capped at 101 to support a 100-record page plus a next-page sentinel. All query functions run as invoker through message, subscription, profile and workspace RLS.

Reply notifications go only to current followers or exact mentions, rather than every unrelated channel member. Channel mute, mentions-only settings and DND still apply. Invalidations sent to followers contain table/operation identifiers only, so unread counts can refresh even when a notification preference suppresses alerts.

## Durable drafts

`message_drafts` stores a single draft per authenticated user, conversation and parent. The generated `draft_key` uses the distinct literal `main` for a null parent, avoiding PostgreSQL's nullable-unique ambiguity without colliding with UUID thread IDs. Draft bodies are limited to 12,000 characters.

`save_draft(p_conversation_id,p_body,p_parent_id)` derives identity from the session, validates current write access and a live top-level parent, and upserts atomically. An empty string removes that context's draft. `clear_draft` deletes only the caller's context; owned cleanup is permitted after revocation without revealing or changing anyone else's data. Direct client INSERT/UPDATE/DELETE grants do not exist. Read RLS hides drafts if channel access is revoked, the channel is archived or the parent is deleted. Unarchiving restores access to retained text.

Draft changes broadcast no body or parent data. Competing devices currently use last committed text; client autosave must serialize requests and retain unsaved local text on errors. Pending file objects are browser-local and are not stored as durable draft attachments.

## Real-time security

Private topics:

| Topic | Join rule |
| --- | --- |
| `conversation:<uuid>:<epoch>` | Current conversation access |
| `workspace:<uuid>:<epoch>` | Current workspace membership |
| `user:<uuid>` | Own authenticated user ID |

Client channels must set `config.private: true`. Disable **Allow public access** in the dedicated Supabase project's Realtime settings. Policies are applied to `realtime.messages` without attempting to alter that Supabase-owned table's RLS setting. Notifications are added to `supabase_realtime` if that publication exists; Postgres Changes filters notification rows through their recipient RLS policy.

The final migration rotates topic epochs on membership removal. Old topics receive an empty rekey control; subsequent changes publish only to current topics. Clients refetch authorized epochs and reconcile, suppressing stale asynchronous callbacks. SQL routing/revocation checks pass; hosted socket timing remains a release test.

Client Broadcast and native Presence writes are disabled. `set_presence(p_conversation_id,p_away,p_typing)` supplies identity from `auth.uid()` and time from PostgreSQL. Clients cannot select another identity or forge timestamps. Authorized clients read `conversation_presence` after identifier-only database invalidations. Heartbeats every 25 seconds sustain a 60-second lease; typing expires after four seconds. `clear_presence` removes only the caller's row; membership revocation deletes presence. The local expiry timer only affects display and does not grant access. Multiple tabs share the user's conversation row, so closing one tab can cause a transient offline display until another tab's next heartbeat.

Supabase's daily Broadcast partition is created by the first WebSocket client. Connect a client before verifying initial database Broadcast delivery. A warning before the first subscription does not invalidate persisted message rows.

## Storage security

Bucket `attachments` is private, with a 10 MiB provider-enforced size limit and an explicit MIME allowlist. Object paths are `<conversation UUID>/<uploader UUID>/<upload UUID>/<sanitized filename>`. A client cannot upload into another user's path. Staged objects are readable only by their uploader; other current participants can read after attachment metadata links the object to a live message. Metadata cannot be attached to another user's message or a different conversation. Deleting a message hides linked attachment metadata and storage reads from other members.

An aggregate per-user/workspace storage quota is not yet implemented; provider quotas, abuse alerts and an orphan cleanup/retention worker are required before public signup at production scale. The per-file limit does not limit total storage consumption.

## Private avatars and workspace logos

Bucket `profile-media` is private and limited to 2 MiB JPEG, PNG and WebP uploads. Paths are `avatars/<uploader UUID>/<upload UUID>.<jpg|png|webp>` and `workspaces/<workspace UUID>/<uploader UUID>/<upload UUID>.<jpg|png|webp>`. Invalid paths and nonadministrator workspace uploads are denied. Existing buckets with unsafe public/size/MIME settings fail migration rather than being silently accepted.

`set_avatar(p_path)` derives the profile owner from `auth.uid()` and requires an uploaded object in that user's avatar folder. It updates `avatar_path` and clears legacy `avatar_url`; passing null clears both. `set_workspace_logo(p_workspace_id,p_path)` requires a current workspace owner/admin, that administrator's own upload path in the same workspace and an existing stored object, then updates `logo_path`. These return the current profile/workspace as JSON. New path columns have no direct client update grant.

Staged avatar media is readable only by its uploader. Referenced avatars are readable by self or users sharing a workspace. Workspace media requires current workspace membership; other members can read it only after `logo_path` references it. Cleanup permits only the original uploader and only unreferenced objects; workspace cleanup also requires administrator status. Reference changes and cleanup share a per-path transaction advisory lock to prevent a concurrent cleanup deleting a newly selected current photo.

The browser flow decodes/normalizes raster images; Storage enforces declared MIME and size. The SQL harness verifies bucket configuration and authorization, not image decoding or the real Storage API's byte handling. Image changes emit identifier-only workspace/profile invalidations. Signed URLs retain the same expiry limitation as attachments.

Use short-lived signed URLs (60 seconds recommended). Already issued URLs remain usable until expiry; membership revocation cannot retract them instantly. Unlinked uploads and files from deleted channels need a Storage API cleanup job with a retention policy. Do not delete `storage.objects` rows directly as a substitute for deleting the physical objects through the Storage API.

## Scheduled dispatch

Call `process_scheduled_messages()` from the authenticated server cron route using a server-only secret, once per minute. The dispatcher locks due rows with `FOR UPDATE SKIP LOCKED`, processes at most 100, validates current workspace/participant membership, archive state and thread state, and inserts messages idempotently. Invalid schedules retain `failed_at` and `error` for user recovery by cancellation and scheduling again. No service credential belongs in a `NEXT_PUBLIC_` variable or desktop renderer.

An external scheduler is required. Without a configured cron trigger, scheduled messages remain pending. A one-minute trigger provides minute-level scheduling, not exact-second delivery.

## Tests and remaining gates

The local harness verifies hashed invitations/acceptance/revocation, tenant/private/DM isolation, DM reuse, idempotency conflicts (including null-body retries), direct-write forgery denial, message author rules, valid threads, authorized full-text search, caller-owned reactions/saves, monotonic channel/thread read cursors, thread author-follow/unfollow retention/participant summaries/targeted notifications, private-thread API denial, durable draft identity/unique contexts/closed-target controls, role escalation denial, scoped profiles, private-topic policy predicates and client Broadcast/Presence INSERT denial, staged/linked attachment access, deleted attachment visibility, private avatar/logo staging/publication/tenant/reference/deletion policies, channel management, scheduled service-only dispatch and retained failures, mute/exact mentions/DND, aggregate unread counts above 100/recipient isolation/read reduction, archive rejection, ownership transfer, server-owned presence identity/timestamps/expiry/clear and direct-write denial, removal revocation, anonymous denial, all-table RLS, nonprivileged public wrappers and persistent throttling. The rate-limit scenario uses one transaction with a fresh fixture bucket so minute rollover cannot make it flaky.

Before production: apply on an isolated real Supabase project; generate SDK database types; run advisors; test actual Auth/session revocation and private subscriptions; test uploads/MIME/signed URLs with two real users; exercise simultaneous sends, dropped sockets, reconnect catch-up and scheduler concurrency; EXPLAIN indexed history/search; run sustained target load; configure backup retention and test a restore. No production scalability or uptime claim is established by the local suite.

Official documentation checked: [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization), [database Broadcast](https://supabase.com/docs/guides/realtime/broadcast), [Storage access control](https://supabase.com/docs/guides/storage/security/access-control). The changelog was checked by the parent agent; the current prohibition on altering RLS for `realtime.messages` is respected.

Topic revocation migration: `20261028224253_realtime_epoch_revocation.sql` adds versioned topics, revocation rotation, publication routing and escaped-username mention compatibility.

Hosted advisor migration: `20261029095248_foreign_key_indexes.sql` adds six covering foreign-key indexes. See verification/supabase-migrations.json for server-assigned migration versions.

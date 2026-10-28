# Relay: architecture and delivery plan

## Product
An original Slack-inspired team messenger. No voice, video or screen sharing. Dense, keyboard-accessible three-pane communication interface, a narrow workspace rail, permanent global search, thread drawer and real empty states. Indigo ink navigation, warm neutral conversation surface, green presence, compact typography. Light/dark semantic tokens; reduced motion; responsive channel drawer.

## Decisions
- Next.js App Router + TypeScript: server-rendered auth/setup, modular client interaction surfaces, validated server endpoints. Node 24 satisfies current Next.js requirements.
- Supabase PostgreSQL is the source of truth. Workspace membership and conversation participation determine RLS. Clients never receive service-role/secret keys.
- Supabase SSR cookie sessions; verify identity on server. Database mutations independently authorize auth.uid(), including direct REST/RPC calls.
- Conversation abstraction covers public/private channels and 1:1/group DMs. Explicit participants for private channels/DMs; public channels visible only inside their workspace.
- Persist before broadcasting. Database notifications contain identifiers, not message text; clients re-read through RLS. Presence and typing use authenticated database RPCs with server-assigned identity and TTLs; clients cannot publish to private topics. No content is trusted from peers.
- Client UUIDs make retries idempotent. Database identity sequence establishes stable pagination order, with no claim of gap-free sequences. Reconnect re-fetches persisted records and reconciles by ID. Failed sends expose retry.
- TanStack Virtual bounds DOM messages. PostgreSQL GIN full-text index serves authorized search. Private object storage with membership policies and short-lived signed URLs serves uploads.
- Electron shares the deployed application and backend; isolated sandboxed renderer, no Node integration, constrained navigation/IPC. NSIS Windows installer; signed release and update infrastructure remain release gates.
- Avoid Redis/dedicated socket service until profiling justifies them. Realtime quotas and latency must be measured at the intended concurrency; no unmeasured scale claim.

## Data contract
All IDs are UUID strings unless stated. created_at/updated_at are UTC ISO timestamps. Message seq is an identity bigint. Profiles are keyed by auth.users.id.

Tables: profiles(id,display_name,username,avatar_url,status,status_emoji,title,bio,dnd_until); workspaces(id,name,slug,owner_id,created_at); workspace_members(workspace_id,user_id,role,joined_at); conversations(id,workspace_id,name,description,topic,kind,created_by,archived_at,created_at); conversation_members(conversation_id,user_id,last_read_seq,notification_preference); messages(id,conversation_id,author_id,body,parent_id,seq,created_at,edited_at,deleted_at); reactions(message_id,user_id,emoji); saved_messages(user_id,message_id,created_at); pins(conversation_id,message_id,pinned_by,created_at); attachments(id,message_id,conversation_id,uploaded_by,path,name,mime_type,size,created_at); invitations(id,workspace_id,token_hash,created_by,expires_at,max_uses,uses); notifications(id,user_id,workspace_id,conversation_id,message_id,kind,read_at,created_at); scheduled_messages(id,conversation_id,author_id,body,parent_id,scheduled_at,sent_at,failed_at,error,created_at); audit_logs(id,workspace_id,actor_id,action,target_id,details,created_at); conversation_presence(conversation_id,user_id,status,last_seen_at,typing_until).

Kinds: public, private, dm. Roles: owner, admin, member. Notification preference: all, mentions, mute.

RPC names/arguments: create_workspace(p_name); create_conversation(p_workspace_id,p_name,p_kind,p_description,p_member_ids); send_message(p_id,p_conversation_id,p_body,p_parent_id); edit_message(p_id,p_body); delete_message(p_id); toggle_reaction(p_message_id,p_emoji); toggle_saved(p_message_id); mark_read(p_conversation_id,p_seq); create_invite(p_workspace_id); accept_invite(p_token); update_conversation(p_id,p_name,p_description,p_topic,p_archive); join_conversation(p_id); leave_conversation(p_id); pin_message(p_message_id); set_member_role(p_workspace_id,p_user_id,p_role); remove_member(p_workspace_id,p_user_id); schedule_message(p_id,p_conversation_id,p_body,p_parent_id,p_scheduled_at); search_messages(p_workspace_id,p_query,p_conversation_id,p_author_id,p_before,p_limit,p_offset); update_workspace(p_id,p_name); set_notification_preference(p_conversation_id,p_preference); add_conversation_member(p_conversation_id,p_user_id).

## Delivery order
Research and verified dependency/tool inspection → design system → schema/RLS and auth → messaging and private real-time → collaboration/admin/storage → adversarial tests/build → deployment configuration → desktop packaging. Agent tasks run in parallel within those dependencies.

## Validation and release gates
Unit tests for validation, reconciliation and authorization invariants; SQL execution and adversarial RLS tests in isolated database; authenticated browser tests against a real backend; private-channel subscription denial tests; two-user reconnect/concurrency tests. Browser checks at mobile/tablet/desktop; keyboard and accessibility. Build, dependency audit, installer build and smoke tests. Production release additionally requires SMTP, app URL/redirects, backups, monitoring, signed installer/update feed and load-test budgets. Track actual results in STATUS.md; pending gates are never reported as complete.

## Initial performance targets (unverified)
p95 persisted send acknowledgement <800 ms in one region, p95 connected peer visibility <1.5 s, 100 concurrent users / 10 messages per second initial load test, 50 records per page, bounded message DOM, attachments ≤10 MiB. These are acceptance targets, not service guarantees.

## Sources inspected 2026-10-28
- https://nextjs.org/docs/app/getting-started/installation
- https://supabase.com/docs/guides/auth/server-side/creating-a-client
- https://supabase.com/docs/guides/realtime/broadcast
- https://supabase.com/docs/guides/realtime/authorization
- https://www.electronjs.org/docs/latest/tutorial/security
- https://github.com/vercel-labs/skills
- https://github.com/davila7/claude-code-templates

UI UX Pro Max recommended minimal/Swiss style, dense spacing, focus states and reduced motion. Its landing-page recommendations were off-context and were discarded; the application shell follows the user's messaging workflow.

-- Add covering indexes reported by the hosted Supabase performance advisor.
create index audit_logs_actor_idx on public.audit_logs(actor_id);
create index conversations_created_by_idx on public.conversations(created_by);
create index invitations_created_by_idx on public.invitations(created_by);
create index pins_pinned_by_idx on public.pins(pinned_by);
create index scheduled_messages_parent_idx on public.scheduled_messages(parent_id);
create index workspaces_owner_idx on public.workspaces(owner_id);

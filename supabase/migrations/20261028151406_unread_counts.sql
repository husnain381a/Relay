-- Aggregate independently of the bounded notification inbox page.
create index notifications_unread_idx on public.notifications(user_id,workspace_id,conversation_id) where read_at is null;
create function public.unread_counts(p_workspace_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_object_agg(conversation_id,unread_count),'{}'::jsonb)
 from (
  select conversation_id,count(*) unread_count from public.notifications
  where workspace_id=p_workspace_id and user_id=(select auth.uid()) and read_at is null
  group by conversation_id
 ) unread
$$;
revoke all on function public.unread_counts(uuid) from public,anon;
grant execute on function public.unread_counts(uuid) to authenticated;
notify pgrst,'reload schema';

create table public.thread_subscriptions (
 thread_id uuid not null references public.messages(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 last_read_seq bigint not null default 0 check(last_read_seq>=0),
 following boolean not null default true,
 explicitly_unfollowed boolean not null default false,
 updated_at timestamptz not null default now(), primary key(thread_id,user_id)
);
create index thread_subscriptions_user_idx on public.thread_subscriptions(user_id,thread_id);
alter table public.thread_subscriptions enable row level security;
revoke all on public.thread_subscriptions from public,anon,authenticated;
grant select on public.thread_subscriptions to authenticated;
grant all on public.thread_subscriptions to service_role;
create policy thread_subscriptions_read on public.thread_subscriptions for select to authenticated
using(user_id=(select auth.uid()) and exists(select 1 from public.messages m where m.id=thread_id and m.parent_id is null and m.deleted_at is null));

create function private.require_thread(p_thread_id uuid) returns public.messages language plpgsql stable security definer set search_path='' as $$
declare m public.messages; begin
 perform private.require_user();
 select * into m from public.messages where id=p_thread_id and parent_id is null and deleted_at is null;
 if not found or not private.can_access(m.conversation_id) then raise exception 'Thread is unavailable or access was revoked' using errcode='42501'; end if;
 return m;
end $$;
create function private.follow_thread(p_thread_id uuid,p_following boolean) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); begin
 perform private.require_thread(p_thread_id);
 if p_following is null then raise exception 'Choose whether to follow this thread'; end if;
 perform private.throttle('thread_follow',120);
 insert into public.thread_subscriptions(thread_id,user_id,following,explicitly_unfollowed)
 values(p_thread_id,u,p_following,not p_following)
 on conflict(thread_id,user_id) do update set following=excluded.following,explicitly_unfollowed=excluded.explicitly_unfollowed,updated_at=now()
 where public.thread_subscriptions.following is distinct from excluded.following or public.thread_subscriptions.explicitly_unfollowed is distinct from excluded.explicitly_unfollowed;
end $$;
create function private.mark_thread_read(p_thread_id uuid,p_seq bigint) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); latest bigint; cursor_seq bigint; begin
 perform private.require_thread(p_thread_id);
 if p_seq is null or p_seq<0 then raise exception 'Invalid thread cursor'; end if;
 select coalesce(max(seq),0) into latest from public.messages where parent_id=p_thread_id;
 cursor_seq:=least(p_seq,latest);
 insert into public.thread_subscriptions(thread_id,user_id,last_read_seq,following)
 values(p_thread_id,u,cursor_seq,false)
 on conflict(thread_id,user_id) do update set last_read_seq=excluded.last_read_seq,updated_at=now()
 where public.thread_subscriptions.last_read_seq<excluded.last_read_seq;
 update public.notifications set read_at=now() where user_id=u and read_at is null and message_id in(select id from public.messages where parent_id=p_thread_id and seq<=cursor_seq);
end $$;
revoke all on function private.require_thread(uuid),private.follow_thread(uuid,boolean),private.mark_thread_read(uuid,bigint) from public,anon,authenticated;
grant execute on function private.follow_thread(uuid,boolean),private.mark_thread_read(uuid,bigint) to authenticated;
create function public.follow_thread(p_thread_id uuid,p_following boolean) returns void language sql security invoker set search_path='' as $$ select private.follow_thread(p_thread_id,p_following) $$;
create function public.mark_thread_read(p_thread_id uuid,p_seq bigint) returns void language sql security invoker set search_path='' as $$ select private.mark_thread_read(p_thread_id,p_seq) $$;
revoke all on function public.follow_thread(uuid,boolean),public.mark_thread_read(uuid,bigint) from public,anon;
grant execute on function public.follow_thread(uuid,boolean),public.mark_thread_read(uuid,bigint) to authenticated;

create function public.thread_summaries(p_conversation_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_object_agg(root.id,jsonb_build_object(
  'reply_count',(select count(*) from public.messages r where r.parent_id=root.id and r.deleted_at is null),
  'last_reply_seq',(select coalesce(max(seq),0) from public.messages r where r.parent_id=root.id and r.deleted_at is null),
  'last_reply_at',(select max(created_at) from public.messages r where r.parent_id=root.id and r.deleted_at is null),
  'unread_count',case when coalesce(sub.following,false) then (select count(*) from public.messages r where r.parent_id=root.id and r.deleted_at is null and r.author_id<>(select auth.uid()) and r.seq>sub.last_read_seq) else 0 end,
  'following',coalesce(sub.following,false),
  'participants',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from public.profiles p where p.id in(select distinct author_id from public.messages part where (part.parent_id=root.id or part.id=root.id) and part.deleted_at is null) )
 )),'{}'::jsonb)
 from public.messages root left join public.thread_subscriptions sub on sub.thread_id=root.id and sub.user_id=(select auth.uid())
 where root.conversation_id=p_conversation_id and root.parent_id is null and root.deleted_at is null
$$;
create function public.subscribed_threads(p_workspace_id uuid,p_limit integer default 30,p_offset integer default 0)
returns setof public.messages language sql stable security invoker set search_path='' as $$
 select root.* from public.thread_subscriptions sub join public.messages root on root.id=sub.thread_id join public.conversations c on c.id=root.conversation_id
 where sub.user_id=(select auth.uid()) and sub.following and c.workspace_id=p_workspace_id and root.deleted_at is null and root.parent_id is null
 and exists(select 1 from public.messages r where r.parent_id=root.id and r.deleted_at is null)
 order by (select max(seq) from public.messages r where r.parent_id=root.id and r.deleted_at is null) desc,root.id
 limit greatest(1,least(coalesce(p_limit,30),101)) offset greatest(0,least(coalesce(p_offset,0),100000))
$$;
create function public.unread_thread_counts(p_workspace_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_object_agg(conversation_id,n),'{}'::jsonb) from (
  select root.conversation_id,count(*) n from public.thread_subscriptions sub
  join public.messages root on root.id=sub.thread_id join public.messages reply on reply.parent_id=root.id join public.conversations c on c.id=root.conversation_id
  where sub.user_id=(select auth.uid()) and sub.following and c.workspace_id=p_workspace_id
  and root.deleted_at is null and reply.deleted_at is null and reply.author_id<>(select auth.uid()) and reply.seq>sub.last_read_seq
  group by root.conversation_id
 ) unread
$$;
revoke all on function public.thread_summaries(uuid),public.subscribed_threads(uuid,integer,integer),public.unread_thread_counts(uuid) from public,anon;
grant execute on function public.thread_summaries(uuid),public.subscribed_threads(uuid,integer,integer),public.unread_thread_counts(uuid) to authenticated;

create function private.broadcast_thread_subscription() returns trigger language plpgsql security definer set search_path='' as $$
declare row_data jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end; cid uuid; begin
 select conversation_id into cid from public.messages where id=(row_data->>'thread_id')::uuid;
 if cid is not null then perform realtime.send(jsonb_build_object('conversation_id',cid,'table','thread_subscriptions','operation',tg_op),'change','conversation:'||cid::text,true); end if;
 perform realtime.send(jsonb_build_object('table','thread_subscriptions','operation',tg_op),'change','user:'||(row_data->>'user_id'),true);
 return coalesce(new,old);
end $$;
revoke all on function private.broadcast_thread_subscription() from public,anon,authenticated;
create trigger relay_broadcast_thread_subscription after insert or update or delete on public.thread_subscriptions for each row execute function private.broadcast_thread_subscription();

-- Preserve explicit unfollow while automatically following authors.
create or replace function private.message_notifications() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.conversations; root_author uuid; target_thread uuid; follower record; begin
 select * into c from public.conversations where id=new.conversation_id;
 target_thread:=coalesce(new.parent_id,new.id);
 select author_id into root_author from public.messages where id=target_thread;
 insert into public.thread_subscriptions(thread_id,user_id,following)
 select target_thread,v,true from (select distinct unnest(array[new.author_id,root_author]) v) authors where v is not null
 on conflict(thread_id,user_id) do update set following=true,updated_at=now()
 where not public.thread_subscriptions.explicitly_unfollowed and not public.thread_subscriptions.following;
 insert into public.notifications(user_id,workspace_id,conversation_id,message_id,kind)
 select wm.user_id,c.workspace_id,c.id,new.id,
 case when private.body_mentions(new.body,p.username,p.id) then 'mention' when new.parent_id is not null then 'thread' when c.kind='dm' then 'dm' else 'message' end
 from public.workspace_members wm join public.profiles p on p.id=wm.user_id
 left join public.conversation_members cm on cm.conversation_id=c.id and cm.user_id=wm.user_id
 left join public.thread_subscriptions sub on sub.thread_id=target_thread and sub.user_id=wm.user_id
 where wm.workspace_id=c.workspace_id and wm.user_id<>new.author_id and (c.kind='public' or cm.user_id is not null)
 and (p.dnd_until is null or p.dnd_until<=now()) and coalesce(cm.notification_preference,'all')<>'mute'
 and (coalesce(cm.notification_preference,'all')='all' or private.body_mentions(new.body,p.username,p.id))
 and (case when new.parent_id is null then cm.user_id is not null or private.body_mentions(new.body,p.username,p.id)
           else coalesce(sub.following,false) or private.body_mentions(new.body,p.username,p.id) end)
 on conflict(user_id,message_id) do nothing;
 if new.parent_id is not null then
  for follower in select sub.user_id from public.thread_subscriptions sub join public.workspace_members wm on wm.user_id=sub.user_id and wm.workspace_id=c.workspace_id
   where sub.thread_id=target_thread and sub.following and (c.kind='public' or exists(select 1 from public.conversation_members cm where cm.conversation_id=c.id and cm.user_id=sub.user_id)) loop
   perform realtime.send(jsonb_build_object('table','thread_subscriptions','operation','REPLY'),'change','user:'||follower.user_id::text,true);
  end loop;
 end if;
 return new;
end $$;

-- Backfill subscriptions for existing authors without creating content.
insert into public.thread_subscriptions(thread_id,user_id,following)
select distinct coalesce(parent_id,id),author_id,true from public.messages where deleted_at is null
on conflict do nothing;

create or replace function private.mark_read(p_conversation_id uuid,p_seq bigint) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); latest bigint; begin
 if not private.can_access(p_conversation_id) then raise exception 'Conversation access denied' using errcode='42501'; end if;
 if p_seq is null or p_seq<0 then raise exception 'Invalid conversation cursor'; end if;
 select coalesce(max(seq),0) into latest from public.messages where conversation_id=p_conversation_id;
 insert into public.conversation_members(conversation_id,user_id,last_read_seq) values(p_conversation_id,u,least(p_seq,latest))
 on conflict(conversation_id,user_id) do update set last_read_seq=excluded.last_read_seq where public.conversation_members.last_read_seq<excluded.last_read_seq;
 update public.notifications set read_at=now() where user_id=u and conversation_id=p_conversation_id and read_at is null
 and message_id in(select id from public.messages where conversation_id=p_conversation_id and parent_id is null and seq<=p_seq);
end $$;
notify pgrst,'reload schema';

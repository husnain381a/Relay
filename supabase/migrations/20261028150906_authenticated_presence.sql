-- Server-authenticated presence replaces spoofable peer-supplied metadata.
-- Status expires after 60 seconds without a heartbeat; typing lasts four seconds.
create table public.conversation_presence (
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 status text not null check(status in ('online','away')),
 last_seen_at timestamptz not null default now(), typing_until timestamptz,
 primary key(conversation_id,user_id)
);
create index conversation_presence_user_idx on public.conversation_presence(user_id);
create index conversation_presence_expiry_idx on public.conversation_presence(last_seen_at);
alter table public.conversation_presence enable row level security;
revoke all on public.conversation_presence from public,anon,authenticated;
grant select on public.conversation_presence to authenticated;
grant all on public.conversation_presence to service_role;
create policy conversation_presence_read on public.conversation_presence for select to authenticated
using(private.can_access(conversation_id) and last_seen_at>now()-interval '60 seconds');

create function private.set_presence(p_conversation_id uuid,p_away boolean default false,p_typing boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); begin
 if not private.can_access(p_conversation_id) then raise exception 'Conversation access denied' using errcode='42501'; end if;
 perform private.throttle('presence',120);
 insert into public.conversation_presence(conversation_id,user_id,status,last_seen_at,typing_until)
 values(p_conversation_id,u,case when p_away then 'away' else 'online' end,now(),case when p_typing and not p_away then now()+interval '4 seconds' else null end)
 on conflict(conversation_id,user_id) do update set status=excluded.status,last_seen_at=excluded.last_seen_at,typing_until=excluded.typing_until;
 -- Keep the table bounded by recent connections. Deletes also invalidate sockets.
 delete from public.conversation_presence where user_id=u and last_seen_at<now()-interval '1 day';
end $$;
create function private.clear_presence(p_conversation_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); begin
 perform private.throttle('presence_clear',120);
 delete from public.conversation_presence where conversation_id=p_conversation_id and user_id=u;
end $$;
revoke all on function private.set_presence(uuid,boolean,boolean),private.clear_presence(uuid) from public,anon,authenticated;
grant execute on function private.set_presence(uuid,boolean,boolean),private.clear_presence(uuid) to authenticated;
create function public.set_presence(p_conversation_id uuid,p_away boolean default false,p_typing boolean default false)
returns void language sql security invoker set search_path='' as $$ select private.set_presence(p_conversation_id,p_away,p_typing) $$;
create function public.clear_presence(p_conversation_id uuid) returns void language sql security invoker set search_path='' as $$ select private.clear_presence(p_conversation_id) $$;
revoke all on function public.set_presence(uuid,boolean,boolean),public.clear_presence(uuid) from public,anon;
grant execute on function public.set_presence(uuid,boolean,boolean),public.clear_presence(uuid) to authenticated;

create function private.broadcast_presence() returns trigger language plpgsql security definer set search_path='' as $$
declare cid uuid:=coalesce(new.conversation_id,old.conversation_id); begin
 perform realtime.send(jsonb_build_object('conversation_id',cid,'table','conversation_presence','operation',tg_op),'change','conversation:'||cid::text,true);
 return coalesce(new,old);
end $$;
revoke all on function private.broadcast_presence() from public,anon,authenticated;
create trigger relay_broadcast_presence after insert or update or delete on public.conversation_presence for each row execute function private.broadcast_presence();

-- Clients consume database invalidations only. No peer can inject typing,
-- impersonate a presence identity or forge a persisted change through Broadcast.
drop policy if exists relay_realtime_write on realtime.messages;

-- Workspace and private-channel revocation remove stale presence immediately.
create function private.remove_revoked_presence() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='workspace_members' then
  delete from public.conversation_presence where user_id=old.user_id and conversation_id in(select id from public.conversations where workspace_id=old.workspace_id);
 else
  delete from public.conversation_presence where user_id=old.user_id and conversation_id=old.conversation_id;
 end if;
 return old;
end $$;
revoke all on function private.remove_revoked_presence() from public,anon,authenticated;
create trigger relay_revoke_workspace_presence after delete on public.workspace_members for each row execute function private.remove_revoked_presence();
create trigger relay_revoke_conversation_presence after delete on public.conversation_members for each row execute function private.remove_revoked_presence();
notify pgrst,'reload schema';

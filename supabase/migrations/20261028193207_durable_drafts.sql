create table public.message_drafts (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 parent_id uuid references public.messages(id) on delete cascade,
 draft_key text generated always as (coalesce(parent_id::text,'main')) stored,
 body text not null check(char_length(body)<=12000), updated_at timestamptz not null default now(),
 unique(user_id,conversation_id,draft_key)
);
create index message_drafts_conversation_idx on public.message_drafts(conversation_id);
create index message_drafts_parent_idx on public.message_drafts(parent_id) where parent_id is not null;
alter table public.message_drafts enable row level security;
revoke all on public.message_drafts from public,anon,authenticated;
grant select on public.message_drafts to authenticated;
grant all on public.message_drafts to service_role;
create function private.valid_draft_target(p_conversation_id uuid,p_parent_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.can_write(p_conversation_id) and (p_parent_id is null or exists(select 1 from public.messages where id=p_parent_id and conversation_id=p_conversation_id and parent_id is null and deleted_at is null))
$$;
revoke all on function private.valid_draft_target(uuid,uuid) from public,anon;
grant execute on function private.valid_draft_target(uuid,uuid) to authenticated;
create policy message_drafts_read on public.message_drafts for select to authenticated
using(user_id=(select auth.uid()) and private.valid_draft_target(conversation_id,parent_id));

create function private.save_draft(p_conversation_id uuid,p_body text,p_parent_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); draft public.message_drafts; begin
 if not private.valid_draft_target(p_conversation_id,p_parent_id) then raise exception 'Draft target is unavailable or access was revoked' using errcode='42501'; end if;
 if p_body is null or char_length(p_body)>12000 then raise exception 'Drafts can contain at most 12000 characters'; end if;
 perform private.throttle('draft',120);
 if p_body='' then
  delete from public.message_drafts where user_id=u and conversation_id=p_conversation_id and parent_id is not distinct from p_parent_id;
  return null;
 end if;
 insert into public.message_drafts(user_id,conversation_id,parent_id,body) values(u,p_conversation_id,p_parent_id,p_body)
 on conflict(user_id,conversation_id,draft_key) do update set body=excluded.body,updated_at=now()
 returning * into draft;
 return to_jsonb(draft);
end $$;
create function private.clear_draft(p_conversation_id uuid,p_parent_id uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); begin
 perform private.throttle('draft',120);
 -- Cleanup of an owned draft is allowed even if its channel was just revoked.
 delete from public.message_drafts where user_id=u and conversation_id=p_conversation_id and parent_id is not distinct from p_parent_id;
end $$;
revoke all on function private.save_draft(uuid,text,uuid),private.clear_draft(uuid,uuid) from public,anon,authenticated;
grant execute on function private.save_draft(uuid,text,uuid),private.clear_draft(uuid,uuid) to authenticated;
create function public.save_draft(p_conversation_id uuid,p_body text,p_parent_id uuid default null) returns jsonb language sql security invoker set search_path='' as $$ select private.save_draft(p_conversation_id,p_body,p_parent_id) $$;
create function public.clear_draft(p_conversation_id uuid,p_parent_id uuid default null) returns void language sql security invoker set search_path='' as $$ select private.clear_draft(p_conversation_id,p_parent_id) $$;
revoke all on function public.save_draft(uuid,text,uuid),public.clear_draft(uuid,uuid) from public,anon;
grant execute on function public.save_draft(uuid,text,uuid),public.clear_draft(uuid,uuid) to authenticated;

create function private.broadcast_draft() returns trigger language plpgsql security definer set search_path='' as $$
declare uid uuid:=coalesce(new.user_id,old.user_id); begin
 -- The body never enters a socket payload, including on the user's own topic.
 perform realtime.send(jsonb_build_object('table','message_drafts','operation',tg_op),'change','user:'||uid::text,true);
 return coalesce(new,old);
end $$;
revoke all on function private.broadcast_draft() from public,anon,authenticated;
create trigger relay_broadcast_draft after insert or update or delete on public.message_drafts for each row execute function private.broadcast_draft();
notify pgrst,'reload schema';

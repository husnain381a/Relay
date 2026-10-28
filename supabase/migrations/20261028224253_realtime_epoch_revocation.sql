-- A revoked member's cached socket receives a rekey control event only.
-- All subsequent activity is routed to new, freshly authorized topics.
alter table public.workspaces add column realtime_epoch uuid not null default gen_random_uuid();
alter table public.conversations add column realtime_epoch uuid not null default gen_random_uuid();

create function private.topic_for(p_kind text,p_id uuid) returns text language sql stable security definer set search_path='' as $$
 select p_kind||':'||p_id::text||':'||value::text from (
  select realtime_epoch value from public.conversations where p_kind='conversation' and id=p_id
  union all select realtime_epoch from public.workspaces where p_kind='workspace' and id=p_id
 ) x
$$;
revoke all on function private.topic_for(text,uuid) from public,anon,authenticated;

create or replace function private.can_join_topic(p_topic text) returns boolean language plpgsql stable security definer set search_path='' as $$
declare parts text[]:=string_to_array(p_topic,':'); target uuid; epoch uuid; begin
 if auth.uid() is null then return false; end if;
 if array_length(parts,1)=2 and parts[1]='user' then return parts[2]=auth.uid()::text; end if;
 if array_length(parts,1)<>3 then return false; end if;
 target:=parts[2]::uuid; epoch:=parts[3]::uuid;
 if parts[1]='conversation' then return private.can_access(target) and exists(select 1 from public.conversations where id=target and realtime_epoch=epoch); end if;
 if parts[1]='workspace' then return private.is_member(target) and exists(select 1 from public.workspaces where id=target and realtime_epoch=epoch); end if;
 return false;
exception when invalid_text_representation then return false;
end $$;
revoke all on function private.can_join_topic(text) from public,anon;
grant execute on function private.can_join_topic(text) to authenticated;

create function private.announce_epoch() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.realtime_epoch is distinct from new.realtime_epoch then
  perform realtime.send('{}'::jsonb,'rekey',(case when tg_table_name='workspaces' then 'workspace' else 'conversation' end)||':'||old.id::text||':'||old.realtime_epoch::text,true);
 end if;
 return new;
end $$;
revoke all on function private.announce_epoch() from public,anon,authenticated;
create trigger relay_epoch_rekey before update of realtime_epoch on public.workspaces for each row execute function private.announce_epoch();
create trigger relay_epoch_rekey before update of realtime_epoch on public.conversations for each row execute function private.announce_epoch();

create function private.rotate_revoked_topics() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='workspace_members' then
  update public.workspaces set realtime_epoch=gen_random_uuid() where id=old.workspace_id;
  update public.conversations set realtime_epoch=gen_random_uuid() where workspace_id=old.workspace_id;
 else
  update public.conversations set realtime_epoch=gen_random_uuid() where id=old.conversation_id and kind in('private','dm');
 end if;
 return old;
end $$;
revoke all on function private.rotate_revoked_topics() from public,anon,authenticated;
create trigger relay_rotate_workspace_topics before delete on public.workspace_members for each row execute function private.rotate_revoked_topics();
create trigger relay_rotate_conversation_topic before delete on public.conversation_members for each row execute function private.rotate_revoked_topics();

create or replace function private.broadcast_change() returns trigger language plpgsql security definer set search_path='' as $$
declare r jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end; cid uuid; mid uuid; wid uuid; topic text; begin
 if tg_table_name='messages' then cid:=(r->>'conversation_id')::uuid; mid:=(r->>'id')::uuid;
 elsif tg_table_name in ('reactions','pins','attachments') then mid:=(r->>'message_id')::uuid; select conversation_id into cid from public.messages where id=mid;
 elsif tg_table_name='conversation_members' then cid:=(r->>'conversation_id')::uuid;
 elsif tg_table_name='conversations' then cid:=(r->>'id')::uuid; wid:=(r->>'workspace_id')::uuid;
 elsif tg_table_name='notifications' then perform realtime.send(jsonb_build_object('table',tg_table_name,'operation',tg_op),'change','user:'||(r->>'user_id'),true);
 elsif tg_table_name='workspace_members' then wid:=(r->>'workspace_id')::uuid;
 end if;
 if cid is not null then
  wid:=coalesce(wid,(select workspace_id from public.conversations where id=cid)); topic:=private.topic_for('conversation',cid);
  if topic is not null then perform realtime.send(jsonb_build_object('conversation_id',cid,'message_id',mid,'table',tg_table_name,'operation',tg_op),'change',topic,true); end if;
 end if;
 if wid is not null then topic:=private.topic_for('workspace',wid); if topic is not null then perform realtime.send(jsonb_build_object('table',tg_table_name,'operation',tg_op),'change',topic,true); end if; end if;
 return coalesce(new,old);
end $$;
create or replace function private.broadcast_presence() returns trigger language plpgsql security definer set search_path='' as $$
declare cid uuid:=coalesce(new.conversation_id,old.conversation_id); topic text; begin
 topic:=private.topic_for('conversation',cid);
 if topic is not null then perform realtime.send(jsonb_build_object('conversation_id',cid,'table','conversation_presence','operation',tg_op),'change',topic,true); end if;
 return coalesce(new,old);
end $$;
create or replace function private.broadcast_thread_subscription() returns trigger language plpgsql security definer set search_path='' as $$
declare row_data jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end; cid uuid; topic text; begin
 select conversation_id into cid from public.messages where id=(row_data->>'thread_id')::uuid;
 topic:=private.topic_for('conversation',cid);
 if topic is not null then perform realtime.send(jsonb_build_object('conversation_id',cid,'table','thread_subscriptions','operation',tg_op),'change',topic,true); end if;
 perform realtime.send(jsonb_build_object('table','thread_subscriptions','operation',tg_op),'change','user:'||(row_data->>'user_id'),true);
 return coalesce(new,old);
end $$;
create or replace function private.broadcast_profile_media() returns trigger language plpgsql security definer set search_path='' as $$
declare member record; topic text; begin
 if tg_table_name='profiles' then
  perform realtime.send(jsonb_build_object('table','profiles','operation','UPDATE'),'change','user:'||new.id::text,true);
  for member in select workspace_id from public.workspace_members where user_id=new.id loop
   topic:=private.topic_for('workspace',member.workspace_id);
   if topic is not null then perform realtime.send(jsonb_build_object('table','profiles','operation','UPDATE'),'change',topic,true); end if;
  end loop;
 else
  topic:=private.topic_for('workspace',new.id);
  if topic is not null then perform realtime.send(jsonb_build_object('table','workspaces','operation','UPDATE'),'change',topic,true); end if;
 end if;
 return new;
end $$;
revoke all on function private.broadcast_change(),private.broadcast_presence(),private.broadcast_thread_subscription(),private.broadcast_profile_media() from public,anon,authenticated;

-- A rendered @user_name may be serialized as @user\_name by the Markdown editor.
create or replace function private.body_mentions(p_body text,p_username text,p_user_id uuid) returns boolean language sql immutable security invoker set search_path='' as $$
 select replace(p_body,chr(92)||'_','_') ~ ('(^|[^a-zA-Z0-9_])@'||p_username||'([^a-zA-Z0-9_]|$)')
 or p_body ~ ('(^|[^a-zA-Z0-9_-])@'||p_user_id::text||'([^a-zA-Z0-9_-]|$)')
$$;
notify pgrst,'reload schema';

-- Relay canonical schema. Apply through the generated migration, not this draft.
-- No production users, messages or example workspaces are seeded.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null check (char_length(display_name) between 1 and 80),
 username text not null unique check (username ~ '^[a-z0-9_]{3,40}$'),
 avatar_url text check (avatar_url is null or char_length(avatar_url) <= 2048),
 status text not null default '' check (char_length(status) <= 100),
 status_emoji text not null default '' check (char_length(status_emoji) <= 12),
 title text not null default '' check (char_length(title) <= 100),
 bio text not null default '' check (char_length(bio) <= 1000),
 dnd_until timestamptz, created_at timestamptz not null default now()
);
create table public.workspaces (
 id uuid primary key default gen_random_uuid(), name text not null check(char_length(name) between 1 and 80),
 slug text not null unique, owner_id uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create table public.workspace_members (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 role text not null default 'member' check(role in ('owner','admin','member')),
 joined_at timestamptz not null default now(), primary key(workspace_id,user_id)
);
create index workspace_members_user_idx on public.workspace_members(user_id,workspace_id);
create unique index workspace_single_owner_idx on public.workspace_members(workspace_id) where role='owner';
create table public.conversations (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
 name text not null check(char_length(name) between 1 and 80), description text not null default '' check(char_length(description)<=500),
 topic text not null default '' check(char_length(topic)<=250), kind text not null check(kind in ('public','private','dm')),
 created_by uuid not null references public.profiles(id), archived_at timestamptz, created_at timestamptz not null default now()
);
create index conversations_workspace_idx on public.conversations(workspace_id,created_at);
create unique index conversations_channel_name_idx on public.conversations(workspace_id,lower(name)) where kind<>'dm' and archived_at is null;
create table public.conversation_members (
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 last_read_seq bigint not null default 0 check(last_read_seq>=0),
 notification_preference text not null default 'all' check(notification_preference in ('all','mentions','mute')),
 joined_at timestamptz not null default now(), primary key(conversation_id,user_id)
);
create index conversation_members_user_idx on public.conversation_members(user_id,conversation_id);
create table public.messages (
 id uuid primary key, conversation_id uuid not null references public.conversations(id) on delete cascade,
 author_id uuid not null references public.profiles(id), body text not null check(char_length(body)<=12000),
 parent_id uuid references public.messages(id) on delete cascade,
 seq bigint generated always as identity unique, created_at timestamptz not null default now(),
 edited_at timestamptz, deleted_at timestamptz,
 search_vector tsvector generated always as (to_tsvector('english',body)) stored,
 check(parent_id is null or parent_id<>id), check(deleted_at is not null or char_length(btrim(body))>0)
);
create index messages_conversation_seq_idx on public.messages(conversation_id,seq desc);
create index messages_parent_idx on public.messages(parent_id,seq) where parent_id is not null;
create index messages_author_idx on public.messages(author_id);
create index messages_search_idx on public.messages using gin(search_vector) where deleted_at is null;
create table public.reactions (
 message_id uuid not null references public.messages(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 emoji text not null check(char_length(emoji) between 1 and 16), created_at timestamptz not null default now(),
 primary key(message_id,user_id,emoji)
);
create index reactions_user_idx on public.reactions(user_id);
create table public.saved_messages (
 user_id uuid not null references public.profiles(id) on delete cascade,
 message_id uuid not null references public.messages(id) on delete cascade,
 created_at timestamptz not null default now(), primary key(user_id,message_id)
);
create index saved_messages_message_idx on public.saved_messages(message_id);
create table public.pins (
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 message_id uuid not null references public.messages(id) on delete cascade,
 pinned_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 primary key(conversation_id,message_id)
);
create index pins_message_idx on public.pins(message_id);
create table public.attachments (
 id uuid primary key default gen_random_uuid(), message_id uuid not null references public.messages(id) on delete cascade,
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 uploaded_by uuid not null references public.profiles(id), path text not null unique,
 name text not null check(char_length(name) between 1 and 255), mime_type text not null check(mime_type in ('image/png','image/jpeg','image/webp','image/gif','application/pdf','text/plain','text/csv','application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
 size bigint not null check(size between 1 and 10485760), created_at timestamptz not null default now()
);
create index attachments_message_idx on public.attachments(message_id);
create index attachments_conversation_idx on public.attachments(conversation_id);
create index attachments_uploader_idx on public.attachments(uploaded_by);
create table public.invitations (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
 token_hash text not null unique, created_by uuid not null references public.profiles(id),
 expires_at timestamptz not null, max_uses integer not null default 25 check(max_uses between 1 and 100),
 uses integer not null default 0 check(uses>=0), created_at timestamptz not null default now()
);
create index invitations_workspace_idx on public.invitations(workspace_id);
create table public.notifications (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 message_id uuid not null references public.messages(id) on delete cascade,
 kind text not null check(kind in ('mention','dm','thread','message')),
 read_at timestamptz, created_at timestamptz not null default now(), unique(user_id,message_id)
);
create index notifications_user_created_idx on public.notifications(user_id,created_at desc);
create index notifications_workspace_idx on public.notifications(workspace_id);
create index notifications_conversation_idx on public.notifications(conversation_id);
create index notifications_message_idx on public.notifications(message_id);
create table public.scheduled_messages (
 id uuid primary key, conversation_id uuid not null references public.conversations(id) on delete cascade,
 author_id uuid not null references public.profiles(id) on delete cascade,
 body text not null check(char_length(btrim(body)) between 1 and 12000),
 parent_id uuid references public.messages(id) on delete cascade,
 scheduled_at timestamptz not null, sent_at timestamptz, failed_at timestamptz, error text, created_at timestamptz not null default now()
);
create index scheduled_due_idx on public.scheduled_messages(scheduled_at) where sent_at is null and failed_at is null;
create index scheduled_author_idx on public.scheduled_messages(author_id,scheduled_at);
create index scheduled_conversation_idx on public.scheduled_messages(conversation_id);
create table public.audit_logs (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
 actor_id uuid references public.profiles(id), action text not null, target_id uuid,
 details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index audit_logs_workspace_idx on public.audit_logs(workspace_id,created_at desc);
create table private.rate_limits (
 user_id uuid not null references public.profiles(id) on delete cascade, bucket text not null,
 window_at timestamptz not null, count integer not null default 1, primary key(user_id,bucket,window_at)
);
alter table private.rate_limits enable row level security;

create function private.is_member(p_workspace_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=auth.uid())
$$;
create function private.is_admin(p_workspace_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=auth.uid() and role in ('owner','admin'))
$$;
create function private.can_access(p_conversation_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.conversations c join public.workspace_members w on w.workspace_id=c.workspace_id and w.user_id=auth.uid()
 where c.id=p_conversation_id and (c.kind='public' or exists(select 1 from public.conversation_members cm where cm.conversation_id=c.id and cm.user_id=auth.uid())))
$$;
create function private.can_write(p_conversation_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.can_access(p_conversation_id) and exists(select 1 from public.conversations where id=p_conversation_id and archived_at is null)
$$;
create function private.shared_profile(p_user_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (p_user_id=auth.uid() or exists(select 1 from public.workspace_members a join public.workspace_members b using(workspace_id) where a.user_id=auth.uid() and b.user_id=p_user_id))
$$;
create function private.message_access(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.messages where id=p_id and private.can_access(conversation_id))
$$;
create function private.require_user() returns uuid language plpgsql stable security invoker set search_path='' as $$
begin if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if; return auth.uid(); end $$;
create function private.throttle(p_bucket text,p_limit integer default 120) returns void language plpgsql security definer set search_path='' as $$
declare n integer; u uuid:=private.require_user(); begin
 insert into private.rate_limits(user_id,bucket,window_at) values(u,p_bucket,date_trunc('minute',now()))
 on conflict(user_id,bucket,window_at) do update set count=private.rate_limits.count+1 returning count into n;
 if n>p_limit then raise exception 'Rate limit reached. Try again in one minute.' using errcode='P0001'; end if;
 delete from private.rate_limits where user_id=u and window_at<now()-interval '1 day';
end $$;

-- Public tables deny writes unless an explicit policy and column grant exist.
do $$ declare t text; begin foreach t in array array['profiles','workspaces','workspace_members','conversations','conversation_members','messages','reactions','saved_messages','pins','attachments','invitations','notifications','scheduled_messages','audit_logs'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
end loop; end $$;
create policy profiles_read on public.profiles for select to authenticated using(private.shared_profile(id));
create policy profiles_update on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
grant update(display_name,username,avatar_url,status,status_emoji,title,bio,dnd_until) on public.profiles to authenticated;
create policy workspaces_read on public.workspaces for select to authenticated using(private.is_member(id));
create policy workspace_members_read on public.workspace_members for select to authenticated using(private.is_member(workspace_id));
create policy conversations_read on public.conversations for select to authenticated using(private.can_access(id));
create policy conversation_members_read on public.conversation_members for select to authenticated using(private.can_access(conversation_id));
create policy messages_read on public.messages for select to authenticated using(private.can_access(conversation_id));
create policy reactions_read on public.reactions for select to authenticated using(private.message_access(message_id));
create policy saved_messages_read on public.saved_messages for select to authenticated using(user_id=(select auth.uid()) and private.message_access(message_id));
create policy pins_read on public.pins for select to authenticated using(private.can_access(conversation_id));
create policy attachments_read on public.attachments for select to authenticated using(private.can_access(conversation_id) and exists(select 1 from public.messages m where m.id=message_id and m.deleted_at is null));
create policy invitations_read on public.invitations for select to authenticated using(private.is_admin(workspace_id));
create policy notifications_read on public.notifications for select to authenticated using(user_id=(select auth.uid()) and private.can_access(conversation_id));
create policy notifications_update on public.notifications for update to authenticated using(user_id=(select auth.uid()) and private.can_access(conversation_id)) with check(user_id=(select auth.uid()) and private.can_access(conversation_id));
grant update(read_at) on public.notifications to authenticated;
create policy scheduled_messages_read on public.scheduled_messages for select to authenticated using(author_id=(select auth.uid()) and private.can_access(conversation_id));
create policy scheduled_messages_cancel on public.scheduled_messages for delete to authenticated using(author_id=(select auth.uid()) and sent_at is null);
grant delete on public.scheduled_messages to authenticated;
create policy audit_logs_read on public.audit_logs for select to authenticated using(private.is_admin(workspace_id));

-- Profiles are created by Auth only. Metadata supplies presentation, never roles.
create function private.on_auth_user() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,display_name,username) values(new.id,
 coalesce(nullif(left(btrim(new.raw_user_meta_data->>'display_name'),80),''),'Teammate'),
 'u_'||replace(new.id::text,'-','')) on conflict(id) do nothing;
 return new;
end $$;
create trigger relay_auth_user after insert on auth.users for each row execute function private.on_auth_user();

create function private.create_workspace(p_name text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); w public.workspaces; c uuid; begin
 perform private.throttle('workspace',5);
 if char_length(btrim(p_name)) not between 1 and 80 then raise exception 'Workspace name must contain 1–80 characters'; end if;
 insert into public.workspaces(name,slug,owner_id) values(btrim(p_name),left(regexp_replace(lower(btrim(p_name)),'[^a-z0-9]+','-','g'),50)||'-'||left(gen_random_uuid()::text,8),u) returning * into w;
 insert into public.workspace_members values(w.id,u,'owner',now());
 insert into public.conversations(workspace_id,name,description,kind,created_by) values(w.id,'general','A place for the whole team.','public',u) returning id into c;
 insert into public.conversation_members(conversation_id,user_id) values(c,u);
 insert into public.audit_logs(workspace_id,actor_id,action,target_id) values(w.id,u,'workspace.created',w.id);
 return to_jsonb(w);
end $$;
create function private.create_conversation(p_workspace_id uuid,p_name text,p_kind text default 'public',p_description text default '',p_member_ids uuid[] default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); c public.conversations; m uuid; participants uuid[]; begin
 if not private.is_member(p_workspace_id) then raise exception 'Workspace access denied' using errcode='42501'; end if;
 perform private.throttle('conversation',20);
 if p_kind not in ('public','private','dm') or char_length(btrim(p_name)) not between 1 and 80 or char_length(p_description)>500 or cardinality(p_member_ids)>49 then raise exception 'Invalid conversation'; end if;
 if p_kind='dm' and cardinality(array_remove(p_member_ids,u))=0 then raise exception 'Choose at least one other member'; end if;
 foreach m in array p_member_ids loop if not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=m) then raise exception 'Participants must belong to this workspace' using errcode='42501'; end if; end loop;
 select array_agg(v order by v) into participants from (select distinct unnest(array_append(p_member_ids,u)) v) x;
 if p_kind='dm' and cardinality(participants)=2 then
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||participants::text,0));
  select cv.* into c from public.conversations cv where cv.workspace_id=p_workspace_id and cv.kind='dm' and cv.archived_at is null
  and (select array_agg(cm.user_id order by cm.user_id) from public.conversation_members cm where cm.conversation_id=cv.id)=participants limit 1;
  if found then return to_jsonb(c); end if;
 end if;
 insert into public.conversations(workspace_id,name,description,kind,created_by) values(p_workspace_id,btrim(p_name),p_description,p_kind,u) returning * into c;
 insert into public.conversation_members(conversation_id,user_id) select c.id,v from (select distinct unnest(array_append(p_member_ids,u)) v) x;
 insert into public.audit_logs(workspace_id,actor_id,action,target_id) values(p_workspace_id,u,'conversation.created',c.id);
 return to_jsonb(c);
end $$;
create function private.send_message(p_id uuid,p_conversation_id uuid,p_body text,p_parent_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); m public.messages; begin
 if not private.can_write(p_conversation_id) then raise exception 'Conversation is inaccessible or archived' using errcode='42501'; end if;
 select * into m from public.messages where id=p_id;
 if found then
  if m.author_id<>u or m.conversation_id<>p_conversation_id or m.parent_id is distinct from p_parent_id or m.body is distinct from p_body then raise exception 'Message identifier is already in use' using errcode='23505'; end if;
  return to_jsonb(m);
 end if;
 perform private.throttle('message',120);
 if char_length(btrim(p_body)) not between 1 and 12000 then raise exception 'Message must contain 1–12000 characters'; end if;
 if p_parent_id is not null and not exists(select 1 from public.messages where id=p_parent_id and conversation_id=p_conversation_id and parent_id is null and deleted_at is null) then raise exception 'Thread must refer to a top-level message in this conversation'; end if;
 insert into public.conversation_members(conversation_id,user_id) values(p_conversation_id,u) on conflict do nothing;
 insert into public.messages(id,conversation_id,author_id,body,parent_id) values(p_id,p_conversation_id,u,p_body,p_parent_id) on conflict(id) do nothing returning * into m;
 if m.id is null then
  select * into m from public.messages where id=p_id;
  if m.author_id<>u or m.conversation_id<>p_conversation_id or m.body is distinct from p_body or m.parent_id is distinct from p_parent_id then raise exception 'Message identifier is already in use' using errcode='23505'; end if;
 end if;
 return to_jsonb(m);
end $$;
create function private.edit_message(p_id uuid,p_body text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); begin
 perform private.throttle('edit',60);
 if char_length(btrim(p_body)) not between 1 and 12000 then raise exception 'Message must contain 1–12000 characters'; end if;
 update public.messages set body=p_body,edited_at=now() where id=p_id and author_id=u and deleted_at is null and private.can_write(conversation_id);
 if not found then raise exception 'Only the author can edit an accessible message' using errcode='42501'; end if;
end $$;
create function private.delete_message(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); w uuid; begin
 perform private.throttle('delete',60);
 update public.messages m set body='',deleted_at=now() where m.id=p_id and private.can_access(m.conversation_id) and (m.author_id=u or exists(select 1 from public.conversations c where c.id=m.conversation_id and c.kind<>'dm' and private.is_admin(c.workspace_id)));
 if not found then raise exception 'Message deletion denied' using errcode='42501'; end if;
 select c.workspace_id into w from public.conversations c join public.messages m on m.conversation_id=c.id where m.id=p_id;
 insert into public.audit_logs(workspace_id,actor_id,action,target_id) values(w,u,'message.deleted',p_id);
 delete from public.reactions where message_id=p_id;
end $$;
create function private.toggle_reaction(p_message_id uuid,p_emoji text) returns boolean language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); begin
 if not private.message_access(p_message_id) or not exists(select 1 from public.messages where id=p_message_id and deleted_at is null) then raise exception 'Message access denied' using errcode='42501'; end if;
 if p_emoji is null or char_length(p_emoji) not between 1 and 16 then raise exception 'Invalid emoji'; end if;
 perform private.throttle('reaction',120);
 delete from public.reactions where message_id=p_message_id and user_id=u and emoji=p_emoji;
 if found then return false; end if;
 insert into public.reactions(message_id,user_id,emoji) values(p_message_id,u,p_emoji) on conflict do nothing;
 return true;
end $$;
create function private.toggle_saved(p_message_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); begin
 if not private.message_access(p_message_id) then raise exception 'Message access denied' using errcode='42501'; end if;
 perform private.throttle('saved',120);
 delete from public.saved_messages where message_id=p_message_id and user_id=u;
 if found then return false; end if;
 insert into public.saved_messages(user_id,message_id) values(u,p_message_id) on conflict do nothing; return true;
end $$;
create function private.mark_read(p_conversation_id uuid,p_seq bigint) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); latest bigint; begin
 if not private.can_access(p_conversation_id) then raise exception 'Conversation access denied' using errcode='42501'; end if;
 select coalesce(max(seq),0) into latest from public.messages where conversation_id=p_conversation_id;
 insert into public.conversation_members(conversation_id,user_id,last_read_seq) values(p_conversation_id,u,greatest(0,least(p_seq,latest)))
 on conflict(conversation_id,user_id) do update set last_read_seq=excluded.last_read_seq where public.conversation_members.last_read_seq<excluded.last_read_seq;
 update public.notifications set read_at=now() where user_id=u and conversation_id=p_conversation_id and read_at is null and message_id in(select id from public.messages where conversation_id=p_conversation_id and seq<=p_seq);
end $$;
create function private.create_invite(p_workspace_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); tok text:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''); i public.invitations; begin
 if not private.is_admin(p_workspace_id) then raise exception 'Only workspace administrators can create invitations' using errcode='42501'; end if;
 perform private.throttle('invite',10);
 insert into public.invitations(workspace_id,token_hash,created_by,expires_at) values(p_workspace_id,encode(sha256(convert_to(tok,'UTF8')),'hex'),u,now()+interval '7 days') returning * into i;
 insert into public.audit_logs(workspace_id,actor_id,action,target_id) values(p_workspace_id,u,'invitation.created',i.id);
 return jsonb_build_object('id',i.id,'token',tok,'expires_at',i.expires_at);
end $$;
create function private.accept_invite(p_token text) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); i public.invitations; begin
 perform private.throttle('accept_invite',10);
 if p_token is null or char_length(p_token)<>64 then raise exception 'Invitation is invalid or expired'; end if;
 select * into i from public.invitations where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
 if not found or i.expires_at<=now() or i.uses>=i.max_uses then raise exception 'Invitation is invalid or expired'; end if;
 if exists(select 1 from public.workspace_members where workspace_id=i.workspace_id and user_id=u) then return i.workspace_id; end if;
 insert into public.workspace_members(workspace_id,user_id) values(i.workspace_id,u);
 insert into public.conversation_members(conversation_id,user_id) select id,u from public.conversations where workspace_id=i.workspace_id and kind='public' and archived_at is null;
 update public.invitations set uses=uses+1 where id=i.id;
 insert into public.audit_logs(workspace_id,actor_id,action,target_id) values(i.workspace_id,u,'member.joined',u);
 return i.workspace_id;
end $$;
create function private.update_conversation(p_id uuid,p_name text,p_description text,p_topic text,p_archive boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); c public.conversations; begin
 select * into c from public.conversations where id=p_id;
 if not found or not private.can_access(p_id) or c.kind='dm' or not(c.created_by=u or private.is_admin(c.workspace_id)) then raise exception 'Channel management denied' using errcode='42501'; end if;
 perform private.throttle('channel_update',60);
 if char_length(btrim(p_name)) not between 1 and 80 or char_length(p_description)>500 or char_length(p_topic)>250 then raise exception 'Invalid channel details'; end if;
 update public.conversations set name=btrim(p_name),description=p_description,topic=p_topic,archived_at=case when p_archive then coalesce(archived_at,now()) else null end where id=p_id;
 insert into public.audit_logs(workspace_id,actor_id,action,target_id) values(c.workspace_id,u,case when p_archive then 'channel.archived' else 'channel.updated' end,p_id);
end $$;
create function private.join_conversation(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); begin
 if not exists(select 1 from public.conversations where id=p_id and kind='public' and archived_at is null and private.is_member(workspace_id)) then raise exception 'Only public channels can be joined directly' using errcode='42501'; end if;
 insert into public.conversation_members(conversation_id,user_id) values(p_id,u) on conflict do nothing;
end $$;
create function private.leave_conversation(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); begin
 if not private.can_access(p_id) then raise exception 'Conversation access denied' using errcode='42501'; end if;
 delete from public.conversation_members where conversation_id=p_id and user_id=u;
end $$;
create function private.pin_message(p_message_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); c uuid; begin
 select conversation_id into c from public.messages where id=p_message_id and deleted_at is null;
 if c is null or not private.can_write(c) then raise exception 'Message access denied' using errcode='42501'; end if;
 perform private.throttle('pin',60);
 delete from public.pins where message_id=p_message_id;
 if found then return false; end if;
 insert into public.pins(conversation_id,message_id,pinned_by) values(c,p_message_id,u) on conflict do nothing; return true;
end $$;
create function private.set_member_role(p_workspace_id uuid,p_user_id uuid,p_role text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); begin
 perform 1 from public.workspaces where id=p_workspace_id for update;
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=u and role='owner') then raise exception 'Only the owner can assign roles' using errcode='42501'; end if;
 if p_role not in ('admin','member') or p_user_id=u then raise exception 'The owner cannot be demoted and ownership cannot be assigned here'; end if;
 update public.workspace_members set role=p_role where workspace_id=p_workspace_id and user_id=p_user_id and role<>'owner';
 if not found then raise exception 'Member not found'; end if;
 insert into public.audit_logs(workspace_id,actor_id,action,target_id,details) values(p_workspace_id,u,'member.role_changed',p_user_id,jsonb_build_object('role',p_role));
end $$;
create function private.remove_member(p_workspace_id uuid,p_user_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); target_role text; actor_role text; begin
 perform 1 from public.workspaces where id=p_workspace_id for update;
 select role into actor_role from public.workspace_members where workspace_id=p_workspace_id and user_id=u;
 select role into target_role from public.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id;
 if target_role is null or target_role='owner' or actor_role is null or not(u=p_user_id or actor_role='owner' or (actor_role='admin' and target_role='member')) then raise exception 'Member removal denied; ownership must be preserved' using errcode='42501'; end if;
 delete from public.conversation_members where user_id=p_user_id and conversation_id in(select id from public.conversations where workspace_id=p_workspace_id);
 delete from public.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id;
 delete from public.scheduled_messages where author_id=p_user_id and sent_at is null and conversation_id in(select id from public.conversations where workspace_id=p_workspace_id);
 insert into public.audit_logs(workspace_id,actor_id,action,target_id) values(p_workspace_id,u,'member.removed',p_user_id);
end $$;
create function private.schedule_message(p_id uuid,p_conversation_id uuid,p_body text,p_parent_id uuid default null,p_scheduled_at timestamptz default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); s public.scheduled_messages; begin
 if not private.can_write(p_conversation_id) then raise exception 'Conversation access denied' using errcode='42501'; end if;
 perform private.throttle('schedule',30);
 if p_scheduled_at is null or p_scheduled_at<=now() or p_scheduled_at>now()+interval '1 year' or char_length(btrim(p_body)) not between 1 and 12000 then raise exception 'Choose a future time within one year and a valid message'; end if;
 if exists(select 1 from public.messages where id=p_id) then raise exception 'Message identifier is already in use' using errcode='23505'; end if;
 if p_parent_id is not null and not exists(select 1 from public.messages where id=p_parent_id and conversation_id=p_conversation_id and parent_id is null and deleted_at is null) then raise exception 'Invalid thread'; end if;
 insert into public.scheduled_messages(id,conversation_id,author_id,body,parent_id,scheduled_at) values(p_id,p_conversation_id,u,p_body,p_parent_id,p_scheduled_at) returning * into s;
 return to_jsonb(s);
end $$;
create function private.search_messages(p_workspace_id uuid,p_query text,p_conversation_id uuid default null,p_author_id uuid default null,p_before timestamptz default null,p_limit integer default 50,p_offset integer default 0) returns setof public.messages language sql stable security invoker set search_path='' as $$
 select m.* from public.messages m join public.conversations c on c.id=m.conversation_id
 where c.workspace_id=p_workspace_id and m.deleted_at is null and char_length(p_query) between 1 and 200
 and m.search_vector @@ websearch_to_tsquery('english',p_query)
 and (p_conversation_id is null or m.conversation_id=p_conversation_id) and (p_author_id is null or m.author_id=p_author_id)
 and (p_before is null or m.created_at<p_before) order by m.seq desc limit greatest(1,least(p_limit,100)) offset greatest(0,least(p_offset,10000))
$$;
create function private.reply_counts(p_conversation_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_object_agg(parent_id,n),'{}'::jsonb) from (select parent_id,count(*) n from public.messages where conversation_id=p_conversation_id and parent_id is not null and deleted_at is null group by parent_id) r
$$;
create function private.update_workspace(p_id uuid,p_name text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); begin
 if not private.is_admin(p_id) then raise exception 'Workspace management denied' using errcode='42501'; end if;
 if char_length(btrim(p_name)) not between 1 and 80 then raise exception 'Invalid workspace name'; end if;
 update public.workspaces set name=btrim(p_name) where id=p_id;
 insert into public.audit_logs(workspace_id,actor_id,action,target_id) values(p_id,u,'workspace.updated',p_id);
end $$;
create function private.set_notification_preference(p_conversation_id uuid,p_preference text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); begin
 if not private.can_access(p_conversation_id) then raise exception 'Conversation access denied' using errcode='42501'; end if;
 if p_preference not in ('all','mentions','mute') then raise exception 'Invalid notification preference'; end if;
 insert into public.conversation_members(conversation_id,user_id,notification_preference) values(p_conversation_id,u,p_preference)
 on conflict(conversation_id,user_id) do update set notification_preference=excluded.notification_preference;
end $$;
create function private.add_conversation_member(p_conversation_id uuid,p_user_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); c public.conversations; begin
 select * into c from public.conversations where id=p_conversation_id;
 if not found or not private.can_write(p_conversation_id) or not exists(select 1 from public.workspace_members where workspace_id=c.workspace_id and user_id=p_user_id)
 or (c.kind='private' and c.created_by<>u and not private.is_admin(c.workspace_id)) then raise exception 'Participant management denied' using errcode='42501'; end if;
 insert into public.conversation_members(conversation_id,user_id) values(p_conversation_id,p_user_id) on conflict do nothing;
 insert into public.audit_logs(workspace_id,actor_id,action,target_id,details) values(c.workspace_id,u,'conversation.member_added',p_user_id,jsonb_build_object('conversation_id',p_conversation_id));
end $$;
create function private.remove_conversation_member(p_conversation_id uuid,p_user_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); c public.conversations; begin
 select * into c from public.conversations where id=p_conversation_id;
 if not found or not private.can_access(p_conversation_id) or not(p_user_id=u or c.created_by=u or (c.kind<>'dm' and private.is_admin(c.workspace_id))) then raise exception 'Participant management denied' using errcode='42501'; end if;
 delete from public.conversation_members where conversation_id=p_conversation_id and user_id=p_user_id;
 insert into public.audit_logs(workspace_id,actor_id,action,target_id,details) values(c.workspace_id,u,'conversation.member_removed',p_user_id,jsonb_build_object('conversation_id',p_conversation_id));
end $$;
create function private.delete_conversation(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); c public.conversations; begin
 select * into c from public.conversations where id=p_id;
 if not found or c.kind='dm' or not private.can_access(p_id) or not(c.created_by=u or private.is_admin(c.workspace_id)) then raise exception 'Channel deletion denied' using errcode='42501'; end if;
 perform private.throttle('channel_delete',10);
 insert into public.audit_logs(workspace_id,actor_id,action,target_id) values(c.workspace_id,u,'channel.deleted',p_id);
 delete from public.conversations where id=p_id;
end $$;
create function private.revoke_invite(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); w uuid; begin
 select workspace_id into w from public.invitations where id=p_id;
 if w is null or not private.is_admin(w) then raise exception 'Invitation management denied' using errcode='42501'; end if;
 update public.invitations set expires_at=now() where id=p_id;
 insert into public.audit_logs(workspace_id,actor_id,action,target_id) values(w,u,'invitation.revoked',p_id);
end $$;
create function private.transfer_ownership(p_workspace_id uuid,p_user_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); begin
 perform 1 from public.workspaces where id=p_workspace_id for update;
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=u and role='owner') or not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id) then raise exception 'Only an owner can transfer ownership to a workspace member' using errcode='42501'; end if;
 update public.workspace_members set role='admin' where workspace_id=p_workspace_id and user_id=u;
 update public.workspace_members set role='owner' where workspace_id=p_workspace_id and user_id=p_user_id;
 update public.workspaces set owner_id=p_user_id where id=p_workspace_id;
 insert into public.audit_logs(workspace_id,actor_id,action,target_id) values(p_workspace_id,u,'workspace.ownership_transferred',p_user_id);
end $$;

create function private.body_mentions(p_body text,p_username text,p_user_id uuid) returns boolean language sql immutable security invoker set search_path='' as $$
 select p_body ~ ('(^|[^a-zA-Z0-9_])@'||p_username||'([^a-zA-Z0-9_]|$)')
 or p_body ~ ('(^|[^a-zA-Z0-9_-])@'||p_user_id::text||'([^a-zA-Z0-9_-]|$)')
$$;
-- Notification records contain identifiers only. Body is always re-read under RLS.
create function private.message_notifications() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.conversations; begin
 select * into c from public.conversations where id=new.conversation_id;
 insert into public.notifications(user_id,workspace_id,conversation_id,message_id,kind)
 select cm.user_id,c.workspace_id,c.id,new.id,case when c.kind='dm' then 'dm' when private.body_mentions(new.body,p.username,p.id) then 'mention' when new.parent_id is not null then 'thread' else 'message' end
 from public.conversation_members cm join public.profiles p on p.id=cm.user_id join public.workspace_members wm on wm.workspace_id=c.workspace_id and wm.user_id=cm.user_id
 where cm.conversation_id=c.id and cm.user_id<>new.author_id and cm.notification_preference<>'mute'
 and (p.dnd_until is null or p.dnd_until<=now())
 and (cm.notification_preference='all' or private.body_mentions(new.body,p.username,p.id))
 on conflict(user_id,message_id) do nothing;
 return new;
end $$;
create trigger relay_notify_message after insert on public.messages for each row execute function private.message_notifications();

create function private.dispatch_scheduled_messages() returns integer language plpgsql security definer set search_path='' as $$
declare s public.scheduled_messages; c public.conversations; n integer:=0; begin
 for s in select * from public.scheduled_messages where sent_at is null and failed_at is null and scheduled_at<=now() order by scheduled_at for update skip locked limit 100 loop
  select * into c from public.conversations where id=s.conversation_id;
  if c.archived_at is null and exists(select 1 from public.workspace_members where workspace_id=c.workspace_id and user_id=s.author_id)
  and (c.kind='public' or exists(select 1 from public.conversation_members where conversation_id=c.id and user_id=s.author_id))
  and (s.parent_id is null or exists(select 1 from public.messages where id=s.parent_id and conversation_id=c.id and parent_id is null and deleted_at is null)) then
   insert into public.messages(id,conversation_id,author_id,body,parent_id) values(s.id,s.conversation_id,s.author_id,s.body,s.parent_id) on conflict(id) do nothing;
   if exists(select 1 from public.messages where id=s.id and author_id=s.author_id and conversation_id=s.conversation_id and body=s.body and parent_id is not distinct from s.parent_id) then
    update public.scheduled_messages set sent_at=now() where id=s.id; n:=n+1;
   else
    update public.scheduled_messages set failed_at=now(),error='Message identifier conflict. Cancel and schedule again.' where id=s.id;
   end if;
  else
   update public.scheduled_messages set failed_at=now(),error='The conversation is archived, access was revoked, or the thread is no longer available. Cancel and schedule again.' where id=s.id;
  end if;
 end loop; return n;
end $$;

-- No EXECUTE grants leak through PostgreSQL's default PUBLIC privilege.
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.is_member(uuid),private.is_admin(uuid),private.can_access(uuid),private.can_write(uuid),private.shared_profile(uuid),private.message_access(uuid) to authenticated;

-- Public API wrappers are SECURITY INVOKER. Privileged code is non-exposed and
-- independently checks auth.uid() and every affected workspace/conversation.
do $$ declare f record; names text; call_names text; begin
 for f in select p.*,pg_get_function_arguments(p.oid) args,pg_get_function_result(p.oid) result from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='private' and p.proname in ('create_workspace','create_conversation','send_message','edit_message','delete_message','toggle_reaction','toggle_saved','mark_read','create_invite','accept_invite','revoke_invite','transfer_ownership','update_conversation','delete_conversation','join_conversation','leave_conversation','pin_message','set_member_role','remove_member','schedule_message','search_messages','reply_counts','update_workspace','set_notification_preference','add_conversation_member','remove_conversation_member') loop
  select string_agg(quote_ident(v),',') into call_names from unnest(f.proargnames) v;
  execute format('create function public.%I(%s) returns %s language sql security invoker set search_path='''' as %L',f.proname,f.args,f.result,format('select %sprivate.%I(%s)',case when f.proretset then '* from ' else '' end,f.proname,call_names));
  execute format('revoke all on function public.%I(%s) from public,anon',f.proname,pg_get_function_identity_arguments(f.oid));
  execute format('grant execute on function public.%I(%s) to authenticated',f.proname,pg_get_function_identity_arguments(f.oid));
  execute format('grant execute on function private.%I(%s) to authenticated',f.proname,pg_get_function_identity_arguments(f.oid));
 end loop;
end $$;
create function public.dispatch_scheduled_messages() returns integer language sql security invoker set search_path='' as $$ select private.dispatch_scheduled_messages() $$;
create function public.process_scheduled_messages() returns integer language sql security invoker set search_path='' as $$ select private.dispatch_scheduled_messages() $$;
revoke all on function public.dispatch_scheduled_messages() from public,anon,authenticated;
revoke all on function public.process_scheduled_messages() from public,anon,authenticated;
grant execute on function public.dispatch_scheduled_messages(),private.dispatch_scheduled_messages() to service_role;
grant execute on function public.process_scheduled_messages() to service_role;

-- Object paths: conversation UUID / uploader UUID / upload UUID / filename.
create function private.storage_conversation(p_path text) returns uuid language plpgsql immutable security invoker set search_path='' as $$
begin return split_part(p_path,'/',1)::uuid; exception when invalid_text_representation then return null; end $$;
create function private.owns_upload(p_path text) returns boolean language sql stable security invoker set search_path='' as $$
 select split_part(p_path,'/',2)=(select auth.uid())::text and array_length(string_to_array(p_path,'/'),1)=4
$$;
create function private.storage_read_allowed(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.can_access(private.storage_conversation(p_path)) and
 (private.owns_upload(p_path) or exists(select 1 from public.attachments a join public.messages m on m.id=a.message_id where a.path=p_path and m.deleted_at is null))
$$;
grant execute on function private.storage_conversation(text),private.owns_upload(text),private.storage_read_allowed(text) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('attachments','attachments',false,10485760,array['image/png','image/jpeg','image/webp','image/gif','application/pdf','text/plain','text/csv','application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']) on conflict(id) do nothing;
do $$ begin
 if exists(select 1 from storage.buckets where id='attachments' and
  (public or file_size_limit is null or file_size_limit>10485760 or allowed_mime_types is null or
   not(allowed_mime_types <@ array['image/png','image/jpeg','image/webp','image/gif','application/pdf','text/plain','text/csv','application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']::text[]))) then
  raise exception 'Existing attachments bucket has incompatible access settings. Use a dedicated Relay project.';
 end if;
end $$;
create policy relay_storage_read on storage.objects for select to authenticated using(bucket_id='attachments' and private.storage_read_allowed(name));
create policy relay_storage_upload on storage.objects for insert to authenticated with check(bucket_id='attachments' and private.owns_upload(name) and private.can_write(private.storage_conversation(name)));
create policy relay_storage_delete on storage.objects for delete to authenticated using(bucket_id='attachments' and private.owns_upload(name) and private.can_access(private.storage_conversation(name)));
create policy attachments_insert on public.attachments for insert to authenticated with check(
 uploaded_by=(select auth.uid()) and private.can_write(conversation_id)
 and private.owns_upload(path) and private.storage_conversation(path)=conversation_id
 and exists(select 1 from public.messages m where m.id=message_id and m.conversation_id=attachments.conversation_id and m.author_id=(select auth.uid()) and m.deleted_at is null)
 and exists(select 1 from storage.objects o where o.bucket_id='attachments' and o.name=path)
);
grant insert(id,message_id,conversation_id,uploaded_by,path,name,mime_type,size) on public.attachments to authenticated;
create policy attachments_delete on public.attachments for delete to authenticated using(uploaded_by=(select auth.uid()) and private.can_access(conversation_id));
grant delete on public.attachments to authenticated;

-- Realtime authorization is evaluated on join. Invalidation payloads deliberately
-- contain no message text, so a removed member cannot read content via stale joins.
create function private.can_join_topic(p_topic text) returns boolean language plpgsql stable security invoker set search_path='' as $$
begin
 if p_topic like 'conversation:%' then return private.can_access(substring(p_topic from 14)::uuid); end if;
 if p_topic like 'workspace:%' then return private.is_member(substring(p_topic from 11)::uuid); end if;
 if p_topic like 'user:%' then return substring(p_topic from 6)=auth.uid()::text; end if;
 return false;
exception when invalid_text_representation then return false;
end $$;
grant execute on function private.can_join_topic(text) to authenticated;
create policy relay_realtime_read on realtime.messages for select to authenticated using(private.can_join_topic((select realtime.topic())));
create policy relay_realtime_write on realtime.messages for insert to authenticated with check(private.can_join_topic((select realtime.topic())) and extension in ('broadcast','presence'));
create function private.broadcast_change() returns trigger language plpgsql security definer set search_path='' as $$
declare r jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end; cid uuid; mid uuid; wid uuid; begin
 if tg_table_name='messages' then cid:=(r->>'conversation_id')::uuid; mid:=(r->>'id')::uuid;
 elsif tg_table_name in ('reactions','pins','attachments') then mid:=(r->>'message_id')::uuid; select conversation_id into cid from public.messages where id=mid;
 elsif tg_table_name='conversation_members' then cid:=(r->>'conversation_id')::uuid;
 elsif tg_table_name='conversations' then cid:=(r->>'id')::uuid; wid:=(r->>'workspace_id')::uuid;
 elsif tg_table_name='notifications' then
  perform realtime.send(jsonb_build_object('table',tg_table_name,'operation',tg_op),'change','user:'||(r->>'user_id'),true);
 elsif tg_table_name='workspace_members' then wid:=(r->>'workspace_id')::uuid;
 end if;
 if cid is not null then
  wid:=coalesce(wid,(select workspace_id from public.conversations where id=cid));
  perform realtime.send(jsonb_build_object('conversation_id',cid,'message_id',mid,'table',tg_table_name,'operation',tg_op),'change','conversation:'||cid::text,true);
 end if;
 if wid is not null then perform realtime.send(jsonb_build_object('table',tg_table_name,'operation',tg_op),'change','workspace:'||wid::text,true); end if;
 return coalesce(new,old);
end $$;
do $$ declare t text; begin foreach t in array array['messages','reactions','pins','attachments','conversation_members','conversations','notifications','workspace_members'] loop
 execute format('create trigger relay_broadcast after insert or update or delete on public.%I for each row execute function private.broadcast_change()',t);
end loop; end $$;

-- Prevent implicit grants on future privileged helpers.
revoke execute on function private.on_auth_user(),private.message_notifications(),private.broadcast_change() from public,anon,authenticated;
revoke execute on all functions in schema private from public,anon;
alter default privileges in schema private revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public;
grant usage on schema public to authenticated,service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
notify pgrst,'reload schema';
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then
  alter publication supabase_realtime add table public.notifications;
 end if;
end $$;

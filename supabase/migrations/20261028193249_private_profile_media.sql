alter table public.profiles add column avatar_path text;
alter table public.workspaces add column logo_path text;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('profile-media','profile-media',false,2097152,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
do $$ begin
 if exists(select 1 from storage.buckets where id='profile-media' and (public or file_size_limit is null or file_size_limit>2097152 or allowed_mime_types is null or not(allowed_mime_types <@ array['image/jpeg','image/png','image/webp']::text[]))) then
  raise exception 'Existing profile-media bucket has incompatible access settings. Use a dedicated Relay project.';
 end if;
end $$;
create function private.valid_media_path(p_path text) returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce(p_path ~ '^(avatars/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|workspaces/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$',false)
$$;
create function private.media_owner(p_path text) returns uuid language plpgsql immutable security invoker set search_path='' as $$
begin
 if not private.valid_media_path(p_path) then return null; end if;
 return case when split_part(p_path,'/',1)='avatars' then split_part(p_path,'/',2)::uuid else split_part(p_path,'/',3)::uuid end;
end $$;
create function private.can_upload_media(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.valid_media_path(p_path) and private.media_owner(p_path)=auth.uid()
 and (split_part(p_path,'/',1)='avatars' or private.is_admin(split_part(p_path,'/',2)::uuid))
$$;
create function private.can_read_media(p_path text) returns boolean language plpgsql stable security definer set search_path='' as $$
declare owner uuid; wid uuid; begin
 if auth.uid() is null or not private.valid_media_path(p_path) then return false; end if;
 owner:=private.media_owner(p_path);
 if split_part(p_path,'/',1)='avatars' then
  return owner=auth.uid() or exists(select 1 from public.profiles p where p.id=owner and p.avatar_path=p_path and private.shared_profile(p.id));
 end if;
 wid:=split_part(p_path,'/',2)::uuid;
 return private.is_member(wid) and (owner=auth.uid() or exists(select 1 from public.workspaces w where w.id=wid and w.logo_path=p_path));
end $$;
create function private.can_delete_media(p_path text) returns boolean language plpgsql volatile security definer set search_path='' as $$
begin
 if not private.can_upload_media(p_path) then return false; end if;
 -- Serialize reference changes with cleanup; check after obtaining the lock.
 perform pg_advisory_xact_lock(hashtextextended('relay-media:'||p_path,0));
 return not exists(select 1 from public.profiles where avatar_path=p_path)
 and not exists(select 1 from public.workspaces where logo_path=p_path);
end $$;
revoke all on function private.valid_media_path(text),private.media_owner(text),private.can_upload_media(text),private.can_read_media(text),private.can_delete_media(text) from public,anon;
grant execute on function private.valid_media_path(text),private.media_owner(text),private.can_upload_media(text),private.can_read_media(text),private.can_delete_media(text) to authenticated;
create policy relay_media_read on storage.objects for select to authenticated using(bucket_id='profile-media' and private.can_read_media(name));
create policy relay_media_upload on storage.objects for insert to authenticated with check(bucket_id='profile-media' and private.can_upload_media(name));
create policy relay_media_delete on storage.objects for delete to authenticated using(bucket_id='profile-media' and private.can_delete_media(name));

create function private.set_avatar(p_path text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); p public.profiles; begin
 perform private.throttle('profile_media',30);
 perform 1 from public.profiles where id=u for update;
 if p_path is not null then
  if not private.valid_media_path(p_path) or split_part(p_path,'/',1)<>'avatars' or private.media_owner(p_path)<>u then raise exception 'Choose an uploaded image from your own avatar folder' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('relay-media:'||p_path,0));
  if not exists(select 1 from storage.objects where bucket_id='profile-media' and name=p_path) then raise exception 'Upload the image before choosing it'; end if;
 end if;
 update public.profiles set avatar_path=p_path,avatar_url=null where id=u returning * into p;
 return to_jsonb(p);
end $$;
create function private.set_workspace_logo(p_workspace_id uuid,p_path text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_user(); w public.workspaces; begin
 perform 1 from public.workspaces where id=p_workspace_id for update;
 if not private.is_admin(p_workspace_id) then raise exception 'Only workspace administrators can set its logo' using errcode='42501'; end if;
 perform private.throttle('workspace_media',30);
 if p_path is not null then
  if not private.valid_media_path(p_path) or split_part(p_path,'/',1)<>'workspaces' or split_part(p_path,'/',2)::uuid<>p_workspace_id or private.media_owner(p_path)<>u then raise exception 'Choose an image uploaded by you for this workspace' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('relay-media:'||p_path,0));
  if not exists(select 1 from storage.objects where bucket_id='profile-media' and name=p_path) then raise exception 'Upload the logo before choosing it'; end if;
 end if;
 update public.workspaces set logo_path=p_path where id=p_workspace_id returning * into w;
 insert into public.audit_logs(workspace_id,actor_id,action,target_id) values(p_workspace_id,u,'workspace.logo_updated',p_workspace_id);
 return to_jsonb(w);
end $$;
revoke all on function private.set_avatar(text),private.set_workspace_logo(uuid,text) from public,anon,authenticated;
grant execute on function private.set_avatar(text),private.set_workspace_logo(uuid,text) to authenticated;
create function public.set_avatar(p_path text) returns jsonb language sql security invoker set search_path='' as $$ select private.set_avatar(p_path) $$;
create function public.set_workspace_logo(p_workspace_id uuid,p_path text) returns jsonb language sql security invoker set search_path='' as $$ select private.set_workspace_logo(p_workspace_id,p_path) $$;
revoke all on function public.set_avatar(text),public.set_workspace_logo(uuid,text) from public,anon;
grant execute on function public.set_avatar(text),public.set_workspace_logo(uuid,text) to authenticated;

create function private.broadcast_profile_media() returns trigger language plpgsql security definer set search_path='' as $$
declare member record; begin
 if tg_table_name='profiles' then
  perform realtime.send(jsonb_build_object('table','profiles','operation','UPDATE'),'change','user:'||new.id::text,true);
  for member in select workspace_id from public.workspace_members where user_id=new.id loop
   perform realtime.send(jsonb_build_object('table','profiles','operation','UPDATE'),'change','workspace:'||member.workspace_id::text,true);
  end loop;
 else
  perform realtime.send(jsonb_build_object('table','workspaces','operation','UPDATE'),'change','workspace:'||new.id::text,true);
 end if;
 return new;
end $$;
revoke all on function private.broadcast_profile_media() from public,anon,authenticated;
create trigger relay_profile_media_changed after update of avatar_path,avatar_url on public.profiles for each row execute function private.broadcast_profile_media();
create trigger relay_workspace_media_changed after update of logo_path on public.workspaces for each row execute function private.broadcast_profile_media();
notify pgrst,'reload schema';

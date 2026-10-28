import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Real PostgreSQL (WASM) execution. Supabase-owned schemas are test shims;
// this verifies SQL, grants, RLS and RPC semantics, not hosted socket/storage APIs.
const root = fileURLToPath(new URL('../', import.meta.url));
const db = new PGlite();
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const C='33333333-3333-4333-8333-333333333333';
const D='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
let passed=0;
const checks=[];
const bootstrap = `
 create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create schema storage; create schema realtime;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated,anon,service_role;
 grant execute on function auth.uid() to authenticated,anon,service_role;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb default '{}',owner_id text,unique(bucket_id,name));
 alter table storage.objects enable row level security;
 grant usage on schema storage to authenticated;
 grant select,insert,delete on storage.objects to authenticated;
 create table realtime.messages(id bigint generated always as identity,payload jsonb,extension text,topic text);
 alter table realtime.messages enable row level security;
 grant usage on schema realtime to authenticated;
 grant select,insert on realtime.messages to authenticated;
 create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic',true) $$;
 create table realtime.test_broadcasts(payload jsonb,event text,topic text,is_private boolean);
 create function realtime.send(payload jsonb,event text,topic text,private boolean default true) returns void language plpgsql as $$ begin insert into realtime.test_broadcasts values(payload,event,topic,private); end $$;
`;
async function as(user, sql, params=[], topic) {
 await db.exec('begin');
 try {
  await db.exec('set local role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);
  if(topic!==undefined) await db.query("select set_config('realtime.topic',$1,true)",[topic]);
  const result=await db.query(sql,params); await db.exec('commit'); return result;
 } catch(e) {await db.exec('rollback'); throw e;}
}
async function topicFor(kind,id) { const r=await db.query('select private.topic_for($1,$2) topic',[kind,id]);return r.rows[0].topic; }
async function scalar(user,sql,params=[]) {const r=await as(user,sql,params);return Object.values(r.rows[0])[0];}
async function test(name,fn) {await fn();passed++;checks.push(name);console.log(`PASS ${name}`);}
async function denied(user,sql,params=[],topic) {await assert.rejects(()=>as(user,sql,params,topic));}
try {
 await db.exec(bootstrap);
 for(const name of (await readdir(join(root,'supabase/migrations'))).filter(n=>n.endsWith('.sql')).sort()) {
  await db.exec(await readFile(join(root,'supabase/migrations',name),'utf8'));
 }
 await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'a@test.invalid','{\"display_name\":\"A\"}'),($2,'b@test.invalid','{\"display_name\":\"B\"}'),($3,'c@test.invalid','{\"display_name\":\"C\"}'),($4,'d@test.invalid','{\"display_name\":\"D\"}')",[A,B,C,D]);
 const w1=await scalar(A,'select public.create_workspace($1)',['First']);
 const w2=await scalar(C,'select public.create_workspace($1)',['Second']);
 const general=(await as(A,"select id from public.conversations where workspace_id=$1",[w1.id])).rows[0].id;
 const invite=await scalar(A,'select public.create_invite($1)',[w1.id]);
 await test('invitations store only a SHA-256 hash',async()=> {
  const r=await db.query('select token_hash from public.invitations where id=$1',[invite.id]);
  assert.equal(r.rows[0].token_hash.length,64);assert.notEqual(r.rows[0].token_hash,invite.token);
 });
 await test('invite acceptance creates member + public channel participation',async()=> {
  assert.equal(await scalar(B,'select public.accept_invite($1)',[invite.token]),w1.id);
  assert.equal(await scalar(B,'select count(*)::int from public.conversation_members where conversation_id=$1 and user_id=$2',[general,B]),1);
 });
 const priv=await scalar(A,"select public.create_conversation($1,'leadership','private','',array[]::uuid[])",[w1.id]);
 const dm=await scalar(A,"select public.create_conversation($1,'A and B','dm','',array[$2::uuid])",[w1.id,B]);
 const id='44444444-4444-4444-8444-444444444444';
 const msg=await scalar(A,'select public.send_message($1,$2,$3,null)',[id,general,'Launch notes with secretkeyword']);
 await test('foreign workspace rows are invisible',async()=> {
  assert.equal(await scalar(C,'select count(*)::int from public.messages where conversation_id=$1',[general]),0);
  assert.equal(await scalar(C,'select count(*)::int from public.workspaces where id=$1',[w1.id]),0);
  assert.equal(await scalar(A,'select count(*)::int from public.workspaces where id=$1',[w2.id]),0);
 });
 await test('private channels invisible to nonparticipants in same workspace',async()=> {
  assert.equal(await scalar(B,'select count(*)::int from public.conversations where id=$1',[priv.id]),0);
  await denied(B,'select public.send_message(gen_random_uuid(),$1,\'bad\',null)',[priv.id]);
  await denied(B,'select public.join_conversation($1)',[priv.id]);
 });
 await test('direct message access requires participant + workspace membership',async()=> {
  assert.equal(await scalar(B,'select count(*)::int from public.conversations where id=$1',[dm.id]),1);
  assert.equal(await scalar(C,'select count(*)::int from public.conversations where id=$1',[dm.id]),0);
  await denied(C,'select public.send_message(gen_random_uuid(),$1,\'bad\',null)',[dm.id]);
  const existing=await scalar(B,"select public.create_conversation($1,'B and A','dm','',array[$2::uuid])",[w1.id,A]);
  assert.equal(existing.id,dm.id);
 });
 await test('idempotent retry persists only one message',async()=> {
  const retry=await scalar(A,'select public.send_message($1,$2,$3,null)',[id,general,'Launch notes with secretkeyword']);
  assert.equal(retry.seq,msg.seq);
  assert.equal(await scalar(A,'select count(*)::int from public.messages where id=$1',[id]),1);
  await denied(A,'select public.send_message($1,$2,$3,null)',[id,general,'different']);
  await denied(A,'select public.send_message($1,$2,null,null)',[id,general]);
  await denied(B,'select public.send_message($1,$2,$3,null)',[id,general,'Launch notes with secretkeyword']);
 });
 await test('direct insert and forged author/role writes denied',async()=> {
  await denied(B,"insert into public.messages(id,conversation_id,author_id,body) values(gen_random_uuid(),$1,$2,'forged')",[general,A]);
  await denied(B,"update public.workspace_members set role='owner' where workspace_id=$1 and user_id=$2",[w1.id,B]);
  await denied(B,"insert into public.reactions(message_id,user_id,emoji) values($1,$2,'x')",[id,A]);
  await denied(B,"update public.messages set body='forged' where id=$1",[id]);
  await denied(B,"delete from public.messages where id=$1",[id]);
  await denied(B,"delete from public.workspaces where id=$1",[w1.id]);
  await denied(B,"update public.conversations set kind='public' where id=$1",[priv.id]);
  await denied(B,"insert into public.conversation_members(conversation_id,user_id) values($1,$2)",[priv.id,B]);
  await denied(B,"update public.notifications set user_id=$1 where user_id=$2",[B,A]);
  await denied(B,"update public.scheduled_messages set author_id=$1 where author_id=$2",[B,A]);
 });
 await test('only authors edit and permitted admins delete',async()=> {
  await denied(B,'select public.edit_message($1,$2)',[id,'stolen']);
  await denied(C,'select public.delete_message($1)',[id]);
  await scalar(A,'select public.edit_message($1,$2)',[id,'Launch secretkeyword edited']);
  assert.equal(await scalar(B,'select body from public.messages where id=$1',[id]),'Launch secretkeyword edited');
 });
 const rootmsg=await scalar(A,"select public.send_message(gen_random_uuid(),$1,'Private topic',null)",[priv.id]);
 const reply=await scalar(B,"select public.send_message(gen_random_uuid(),$1,'Reply',$2)",[general,id]);
 await test('threads enforce same conversation and top-level parent',async()=> {
  await denied(A,"select public.send_message(gen_random_uuid(),$1,'cross',$2)",[general,rootmsg.id]);
  await denied(A,"select public.send_message(gen_random_uuid(),$1,'nested',$2)",[general,reply.id]);
  const counts=await scalar(B,'select public.reply_counts($1)',[general]);assert.equal(counts[id],1);
 });
 await test('search obeys workspace and private-conversation RLS',async()=> {
  assert.equal((await as(B,"select * from public.search_messages($1,'secretkeyword')",[w1.id])).rows.length,1);
  assert.equal((await as(C,"select * from public.search_messages($1,'secretkeyword')",[w1.id])).rows.length,0);
  assert.equal((await as(B,"select * from public.search_messages($1,'Private')",[w1.id])).rows.length,0);
 });
 await test('reactions and saves are owned by authenticated caller',async()=> {
  assert.equal(await scalar(B,"select public.toggle_reaction($1,'👍')",[id]),true);
  assert.equal(await scalar(B,"select public.toggle_reaction($1,'👍')",[id]),false);
  assert.equal(await scalar(B,'select public.toggle_saved($1)',[id]),true);
  assert.equal(await scalar(A,'select count(*)::int from public.saved_messages'),0);
 });
 await test('read cursors never regress or exceed persisted messages',async()=> {
  await scalar(B,'select public.mark_read($1,999999999)',[general]);
  const first=await scalar(B,'select last_read_seq from public.conversation_members where conversation_id=$1 and user_id=$2',[general,B]);
  await scalar(B,'select public.mark_read($1,0)',[general]);
  assert.equal(await scalar(B,'select last_read_seq from public.conversation_members where conversation_id=$1 and user_id=$2',[general,B]),first);
  assert.equal(first,reply.seq);
 });
 await test('member cannot create invitations, promote self or remove owner',async()=> {
  await denied(B,'select public.create_invite($1)',[w1.id]);
  await denied(B,"select public.set_member_role($1,$2,'admin')",[w1.id,B]);
  await denied(A,'select public.remove_member($1,$2)',[w1.id,A]);
 });
 await test('profile visibility scoped to shared workspace, update self only',async()=> {
  assert.equal(await scalar(B,'select count(*)::int from public.profiles where id=$1',[A]),1);
  assert.equal(await scalar(C,'select count(*)::int from public.profiles where id=$1',[A]),0);
  await as(B,"update public.profiles set display_name='Changed' where id=$1",[A]);
  assert.equal(await scalar(A,'select display_name from public.profiles where id=$1',[A]),'A');
  await denied(B,"update public.profiles set username='BAD spaces' where id=$1",[B]);
 });
 await test('private realtime topics deny outsiders and nonparticipants',async()=> {
  assert.equal(await scalar(B,'select private.can_join_topic($1)',[await topicFor('conversation',priv.id)]),false);
  assert.equal(await scalar(C,'select private.can_join_topic($1)',[await topicFor('workspace',w1.id)]),false);
  assert.equal(await scalar(B,'select private.can_join_topic($1)',[await topicFor('conversation',general)]),true);
  assert.equal(await scalar(B,'select private.can_join_topic($1)',['user:'+A]),false);
  assert.equal(await scalar(B,'select private.can_join_topic($1)',['conversation:malformed']),false);
  await denied(B,"insert into realtime.messages(extension,topic) values('broadcast',$1)",[await topicFor('conversation',priv.id)],await topicFor('conversation',priv.id));
  await denied(B,"insert into realtime.messages(extension,topic) values('broadcast',$1)",[await topicFor('conversation',general)],await topicFor('conversation',general));
  await denied(B,"insert into realtime.messages(extension,topic) values('presence',$1)",[await topicFor('conversation',general)],await topicFor('conversation',general));
 });
 const path=`${general}/${A}/55555555-5555-4555-8555-555555555555/notes.txt`;
 await test('storage access checks conversation and upload owner',async()=> {
  await as(A,"insert into storage.objects(bucket_id,name) values('attachments',$1)",[path]);
  assert.equal(await scalar(B,"select count(*)::int from storage.objects where name=$1",[path]),0);
  assert.equal(await scalar(C,"select count(*)::int from storage.objects where name=$1",[path]),0);
  await denied(B,"insert into storage.objects(bucket_id,name) values('attachments',$1)",[`${general}/${A}/other/file.txt`]);
  await denied(B,"insert into storage.objects(bucket_id,name) values('attachments',$1)",[`${priv.id}/${B}/other/file.txt`]);
 });
 await test('attachment metadata cannot reference another author or conversation',async()=> {
  await denied(B,"insert into public.attachments(message_id,conversation_id,uploaded_by,path,name,mime_type,size) values($1,$2,$3,$4,'notes.txt','text/plain',10)",[id,general,B,path]);
  await as(A,"insert into public.attachments(message_id,conversation_id,uploaded_by,path,name,mime_type,size) values($1,$2,$3,$4,'notes.txt','text/plain',10)",[id,general,A,path]);
  assert.equal(await scalar(B,"select count(*)::int from storage.objects where name=$1",[path]),1);
  await denied(A,"insert into public.attachments(message_id,conversation_id,uploaded_by,path,name,mime_type,size) values($1,$2,$3,$4,'bad','text/html',10)",[id,general,A,`${general}/${A}/new/bad`]);
 });
 await test('deleted message attachments become unreadable to other members',async()=> {
  await scalar(A,'select public.delete_message($1)',[id]);
  assert.equal(await scalar(B,'select count(*)::int from public.attachments where message_id=$1',[id]),0);
  assert.equal(await scalar(B,'select count(*)::int from storage.objects where name=$1',[path]),0);
 });
 await test('invitation revocation blocks new members',async()=> {
  await denied(B,'select public.revoke_invite($1)',[invite.id]);
  await scalar(A,'select public.revoke_invite($1)',[invite.id]);
  await denied(C,'select public.accept_invite($1)',[invite.token]);
 });
 await test('channel deletion and participant management require permission',async()=> {
  await denied(B,'select public.delete_conversation($1)',[priv.id]);
  await scalar(A,'select public.add_conversation_member($1,$2)',[priv.id,B]);
  assert.equal(await scalar(B,'select count(*)::int from public.conversations where id=$1',[priv.id]),1);
  await scalar(A,'select public.remove_conversation_member($1,$2)',[priv.id,B]);
  assert.equal(await scalar(B,'select count(*)::int from public.conversations where id=$1',[priv.id]),0);
  await scalar(A,'select public.delete_conversation($1)',[priv.id]);
  assert.equal(await scalar(A,'select count(*)::int from public.conversations where id=$1',[priv.id]),0);
 });
 await test('schedule validates future time and service-only dispatcher',async()=> {
  await denied(B,"select public.schedule_message(gen_random_uuid(),$1,'past',null,now()-interval '1 minute')",[general]);
  await denied(B,'select public.process_scheduled_messages()');
  const s=await scalar(B,"select public.schedule_message(gen_random_uuid(),$1,'scheduled',null,now()+interval '1 minute')",[general]);
  await db.query("update public.scheduled_messages set scheduled_at=now()-interval '1 minute' where id=$1",[s.id]);
  await db.exec('begin; set local role service_role');
  const r=await db.query('select public.process_scheduled_messages()');await db.exec('commit');
  assert.equal(Object.values(r.rows[0])[0],1);
  assert.equal(await scalar(A,'select body from public.messages where id=$1',[s.id]),'scheduled');
 });
 await test('notifications honor mute, mentions, DND and own read receipts',async()=> {
  await scalar(B,"select public.set_notification_preference($1,'mute')",[general]);
  const muted=await scalar(A,"select public.send_message(gen_random_uuid(),$1,'muted',null)",[general]);
  assert.equal(await scalar(B,'select count(*)::int from public.notifications where message_id=$1',[muted.id]),0);
  await scalar(B,"select public.set_notification_preference($1,'mentions')",[general]);
  const uname=await scalar(B,'select username from public.profiles where id=$1',[B]);
  const mention=await scalar(A,'select public.send_message(gen_random_uuid(),$1,$2,null)',[general,'Hello @'+uname]);
  assert.equal(await scalar(B,"select count(*)::int from public.notifications where message_id=$1 and kind='mention'",[mention.id]),1);
  const prefix=await scalar(A,'select public.send_message(gen_random_uuid(),$1,$2,null)',[general,'Not @'+uname+'other']);
  assert.equal(await scalar(B,'select count(*)::int from public.notifications where message_id=$1',[prefix.id]),0);
  assert.equal(await scalar(C,'select count(*)::int from public.notifications where message_id=$1',[mention.id]),0);
  await as(B,"update public.profiles set dnd_until=now()+interval '1 hour' where id=$1",[B]);
  const quiet=await scalar(A,'select public.send_message(gen_random_uuid(),$1,$2,null)',[general,'Quiet @'+uname]);
  assert.equal(await scalar(B,'select count(*)::int from public.notifications where message_id=$1',[quiet.id]),0);
  await as(B,'update public.profiles set dnd_until=null where id=$1',[B]);
 });
 await test('unread counts exceed inbox pagination, stay recipient-scoped and clear on read',async()=> {
  const uname=await scalar(B,'select username from public.profiles where id=$1',[B]);
  const ownerBefore=await scalar(A,'select public.unread_counts($1)',[w1.id]);
  assert.equal(ownerBefore[general],2);
  let latest;
  for(let i=0;i<105;i++) latest=await scalar(A,'select public.send_message(gen_random_uuid(),$1,$2,null)',[general,'@'+uname+' unread '+i]);
  const counts=await scalar(B,'select public.unread_counts($1)',[w1.id]);assert.equal(counts[general],106);
  assert.deepEqual(await scalar(C,'select public.unread_counts($1)',[w1.id]),{});
  assert.deepEqual(await scalar(B,'select public.unread_counts($1)',[w2.id]),{});
  assert.deepEqual(await scalar(A,'select public.unread_counts($1)',[w1.id]),ownerBefore);
  await scalar(B,'select public.mark_read($1,$2)',[general,latest.seq]);
  assert.deepEqual(await scalar(B,'select public.unread_counts($1)',[w1.id]),{});
 });
 // Independent feature scenarios get fresh message quotas; no security test
 // relies on fixture calls remaining within a particular wall-clock minute.
 await db.query("delete from private.rate_limits where bucket='message' and user_id in($1,$2)",[A,B]);
 const threadInvite=await scalar(A,'select public.create_invite($1)',[w1.id]);
 await scalar(D,'select public.accept_invite($1)',[threadInvite.token]);
 await scalar(B,"select public.set_notification_preference($1,'all')",[general]);
 const discussion=await scalar(A,"select public.send_message(gen_random_uuid(),$1,'Focused discussion',null)",[general]);
 const discussionReply=await scalar(B,"select public.send_message(gen_random_uuid(),$1,'First reply',$2)",[general,discussion.id]);
 await test('thread authors follow automatically and unrelated members get no reply alert',async()=> {
  const a=await scalar(A,'select public.thread_summaries($1)',[general]);
  assert.equal(a[discussion.id].following,true);assert.equal(a[discussion.id].reply_count,1);
  assert.equal(a[discussion.id].unread_count,1);assert.equal(a[discussion.id].last_reply_seq,discussionReply.seq);
  assert.deepEqual(a[discussion.id].participants.map(p=>p.id).sort(),[A,B].sort());
  const b=await scalar(B,'select public.thread_summaries($1)',[general]);assert.equal(b[discussion.id].following,true);assert.equal(b[discussion.id].unread_count,0);
  assert.equal(await scalar(A,'select count(*)::int from public.notifications where message_id=$1 and kind=\'thread\'',[discussionReply.id]),1);
  assert.equal(await scalar(D,'select count(*)::int from public.notifications where message_id=$1',[discussionReply.id]),0);
  assert.ok((await as(A,'select * from public.subscribed_threads($1,101,0)',[w1.id])).rows.some(m=>m.id===discussion.id));
 });
 await test('channel reads preserve unseen thread replies and thread cursors never regress',async()=> {
  await scalar(A,'select public.mark_read($1,999999999)',[general]);
  assert.equal(await scalar(A,'select count(*)::int from public.notifications where message_id=$1 and read_at is null',[discussionReply.id]),1);
  const unread=await scalar(A,'select public.unread_thread_counts($1)',[w1.id]);assert.equal(unread[general],1);
  await scalar(A,'select public.mark_thread_read($1,$2)',[discussion.id,discussionReply.seq]);
  await scalar(A,'select public.mark_thread_read($1,0)',[discussion.id]);
  assert.equal(await scalar(A,'select last_read_seq from public.thread_subscriptions where thread_id=$1 and user_id=$2',[discussion.id,A]),discussionReply.seq);
  assert.equal(await scalar(A,'select count(*)::int from public.notifications where message_id=$1 and read_at is null',[discussionReply.id]),0);
  assert.deepEqual(await scalar(A,'select public.unread_thread_counts($1)',[w1.id]),{});
 });
 await test('explicit thread unfollow survives author replies and exact mentions still notify',async()=> {
  await scalar(A,'select public.follow_thread($1,false)',[discussion.id]);
  const unmentioned=await scalar(B,"select public.send_message(gen_random_uuid(),$1,'Another reply',$2)",[general,discussion.id]);
  assert.equal(await scalar(A,'select count(*)::int from public.notifications where message_id=$1',[unmentioned.id]),0);
  const uname=await scalar(A,'select username from public.profiles where id=$1',[A]);
  const mention=await scalar(B,'select public.send_message(gen_random_uuid(),$1,$2,$3)',[general,'Question @'+uname,discussion.id]);
  assert.equal(await scalar(A,"select count(*)::int from public.notifications where message_id=$1 and kind='mention'",[mention.id]),1);
  await scalar(A,"select public.send_message(gen_random_uuid(),$1,'Author follows up',$2)",[general,discussion.id]);
  const sub=(await as(A,'select * from public.thread_subscriptions where thread_id=$1',[discussion.id])).rows[0];assert.equal(sub.following,false);assert.equal(sub.explicitly_unfollowed,true);
  assert.ok(!(await as(A,'select * from public.subscribed_threads($1,101,0)',[w1.id])).rows.some(m=>m.id===discussion.id));
 });
 await test('viewing a thread does not force follow, replying follows, mute and DND remain honored',async()=> {
  await scalar(D,'select public.mark_thread_read($1,999999999)',[discussion.id]);
  assert.equal(await scalar(D,'select following from public.thread_subscriptions where thread_id=$1',[discussion.id]),false);
  await scalar(D,"select public.send_message(gen_random_uuid(),$1,'Joining the thread',$2)",[general,discussion.id]);
  assert.equal(await scalar(D,'select following from public.thread_subscriptions where thread_id=$1',[discussion.id]),true);
  await scalar(D,"select public.set_notification_preference($1,'mentions')",[general]);
  const plain=await scalar(B,"select public.send_message(gen_random_uuid(),$1,'No mention',$2)",[general,discussion.id]);
  assert.equal(await scalar(D,'select count(*)::int from public.notifications where message_id=$1',[plain.id]),0);
  const uname=await scalar(D,'select username from public.profiles where id=$1',[D]);
  const mention=await scalar(B,'select public.send_message(gen_random_uuid(),$1,$2,$3)',[general,'Hi @'+uname,discussion.id]);
  assert.equal(await scalar(D,'select count(*)::int from public.notifications where message_id=$1',[mention.id]),1);
  await scalar(D,"select public.set_notification_preference($1,'mute')",[general]);
  const muted=await scalar(B,'select public.send_message(gen_random_uuid(),$1,$2,$3)',[general,'Muted @'+uname,discussion.id]);
  assert.equal(await scalar(D,'select count(*)::int from public.notifications where message_id=$1',[muted.id]),0);
  await scalar(D,"select public.set_notification_preference($1,'all')",[general]);
  await as(D,"update public.profiles set dnd_until=now()+interval '1 hour' where id=$1",[D]);
  const quiet=await scalar(B,"select public.send_message(gen_random_uuid(),$1,'Quiet thread',$2)",[general,discussion.id]);
  assert.equal(await scalar(D,'select count(*)::int from public.notifications where message_id=$1',[quiet.id]),0);
  await as(D,'update public.profiles set dnd_until=null where id=$1',[D]);
 });
 const hiddenChannel=await scalar(A,"select public.create_conversation($1,'secure-drafts','private','',array[]::uuid[])",[w1.id]);
 const hiddenThread=await scalar(A,"select public.send_message(gen_random_uuid(),$1,'Private thread',null)",[hiddenChannel.id]);
 await test('thread APIs cannot reveal private roots, forge authors or accept reply IDs as roots',async()=> {
  await denied(B,'select public.follow_thread($1,true)',[hiddenThread.id]);
  await denied(B,'select public.mark_thread_read($1,999999999)',[hiddenThread.id]);
  await denied(C,'select public.follow_thread($1,true)',[discussion.id]);
  await denied(B,'select public.follow_thread($1,true)',[discussionReply.id]);
  await denied(B,"insert into public.thread_subscriptions(thread_id,user_id,following) values($1,$2,true)",[discussion.id,A]);
  await denied(B,"update public.thread_subscriptions set user_id=$1 where thread_id=$2",[A,discussion.id]);
  assert.deepEqual(await scalar(B,'select public.thread_summaries($1)',[hiddenChannel.id]),{});
  assert.deepEqual(await scalar(C,'select public.unread_thread_counts($1)',[w1.id]),{});
  assert.equal((await as(C,'select * from public.subscribed_threads($1,101,0)',[w1.id])).rows.length,0);
 });
 await test('durable drafts isolate users, normalize main/thread keys and deny direct writes',async()=> {
  const main=await scalar(A,'select public.save_draft($1,$2,null)',[general,'A main draft']);
  const updated=await scalar(A,'select public.save_draft($1,$2,null)',[general,'A updated draft']);assert.equal(updated.id,main.id);
  const threaded=await scalar(A,'select public.save_draft($1,$2,$3)',[general,'A reply draft',discussion.id]);assert.notEqual(threaded.id,main.id);
  await scalar(B,'select public.save_draft($1,$2,null)',[general,'B draft']);
  assert.equal(await scalar(B,'select count(*)::int from public.message_drafts where user_id=$1',[A]),0);
  await scalar(B,'select public.clear_draft($1,null)',[general]);
  assert.equal(await scalar(A,'select count(*)::int from public.message_drafts where id=$1',[main.id]),1);
  await denied(B,"insert into public.message_drafts(user_id,conversation_id,body) values($1,$2,'forged')",[A,general]);
  await denied(B,"update public.message_drafts set body='forged' where id=$1",[main.id]);
  await denied(C,'select public.save_draft($1,$2,null)',[general,'foreign']);
  await denied(B,'select public.save_draft($1,$2,$3)',[general,'wrong root',hiddenThread.id]);
  await denied(A,'select public.save_draft($1,$2,$3)',[general,'nested',discussionReply.id]);
  assert.equal(await scalar(A,'select public.save_draft($1,$2,null)',[general,'']),null);
  assert.equal(await scalar(A,'select count(*)::int from public.message_drafts where id=$1',[main.id]),0);
 });
 await test('deleted roots and archived channels hide drafts and reject further saves',async()=> {
  const draft=await scalar(A,'select public.save_draft($1,$2,$3)',[hiddenChannel.id,'Private reply draft',hiddenThread.id]);
  await scalar(A,'select public.delete_message($1)',[hiddenThread.id]);
  assert.equal(await scalar(A,'select count(*)::int from public.message_drafts where id=$1',[draft.id]),0);
  await denied(A,'select public.save_draft($1,$2,$3)',[hiddenChannel.id,'closed',hiddenThread.id]);
  await denied(A,'select public.follow_thread($1,true)',[hiddenThread.id]);
  const main=await scalar(A,'select public.save_draft($1,$2,null)',[hiddenChannel.id,'Archive draft']);
  await scalar(A,"select public.update_conversation($1,'secure-drafts','','',true)",[hiddenChannel.id]);
  assert.equal(await scalar(A,'select count(*)::int from public.message_drafts where id=$1',[main.id]),0);
  await denied(A,'select public.save_draft($1,$2,null)',[hiddenChannel.id,'archived']);
  await scalar(A,"select public.update_conversation($1,'secure-drafts','','',false)",[hiddenChannel.id]);
  assert.equal(await scalar(A,'select count(*)::int from public.message_drafts where id=$1',[main.id]),1);
 });
 const avatarA=`avatars/${A}/66666666-6666-4666-8666-666666666666.png`;
 const avatarA2=`avatars/${A}/66666666-6666-4666-8666-666666666667.webp`;
 const avatarB=`avatars/${B}/77777777-7777-4777-8777-777777777777.jpg`;
 const logoA=`workspaces/${w1.id}/${A}/88888888-8888-4888-8888-888888888888.webp`;
 const logoB=`workspaces/${w1.id}/${B}/88888888-8888-4888-8888-888888888889.png`;
 await test('profile media bucket is private, raster-only and limited to two MiB',async()=> {
  const bucket=(await db.query("select * from storage.buckets where id='profile-media'")).rows[0];
  assert.equal(bucket.public,false);assert.equal(bucket.file_size_limit,2097152);
  assert.deepEqual([...bucket.allowed_mime_types].sort(),['image/jpeg','image/png','image/webp'].sort());
  await denied(B,"insert into storage.objects(bucket_id,name) values('profile-media',$1)",[avatarA]);
  await denied(A,"insert into storage.objects(bucket_id,name) values('profile-media',$1)",[`avatars/${A}/../bad.svg`]);
 });
 await test('avatars are private while staged, shared only after reference and cannot be forged',async()=> {
  await as(A,"insert into storage.objects(bucket_id,name) values('profile-media',$1)",[avatarA]);
  assert.equal(await scalar(B,'select count(*)::int from storage.objects where name=$1',[avatarA]),0);
  const p=await scalar(A,'select public.set_avatar($1)',[avatarA]);assert.equal(p.avatar_path,avatarA);assert.equal(p.avatar_url,null);
  assert.equal(await scalar(B,'select count(*)::int from storage.objects where name=$1',[avatarA]),1);
  assert.equal(await scalar(C,'select count(*)::int from storage.objects where name=$1',[avatarA]),0);
  await denied(B,'select public.set_avatar($1)',[avatarA]);
  await denied(A,'update public.profiles set avatar_path=$1 where id=$2',[avatarA,A]);
  await denied(A,'select public.set_avatar($1)',[avatarA2]);
  await as(B,'delete from storage.objects where name=$1',[avatarA]);
  assert.equal((await db.query('select count(*)::int n from storage.objects where name=$1',[avatarA])).rows[0].n,1);
 });
 await test('current media is protected from cleanup and replacing/removing an avatar is safe',async()=> {
  await as(A,'delete from storage.objects where name=$1',[avatarA]);
  assert.equal(await scalar(A,'select count(*)::int from storage.objects where name=$1',[avatarA]),1);
  await as(A,"insert into storage.objects(bucket_id,name) values('profile-media',$1)",[avatarA2]);
  await scalar(A,'select public.set_avatar($1)',[avatarA2]);
  await as(A,'delete from storage.objects where name=$1',[avatarA]);
  assert.equal((await db.query('select count(*)::int n from storage.objects where name=$1',[avatarA])).rows[0].n,0);
  await as(A,"update public.profiles set avatar_url='https://example.invalid/legacy.png' where id=$1",[A]);
  const removed=await scalar(A,'select public.set_avatar(null)');assert.equal(removed.avatar_path,null);assert.equal(removed.avatar_url,null);
  await as(B,"insert into storage.objects(bucket_id,name) values('profile-media',$1)",[avatarB]);
  await scalar(B,'select public.set_avatar($1)',[avatarB]);
  assert.equal(await scalar(A,'select count(*)::int from storage.objects where name=$1',[avatarB]),1);
 });
 await test('workspace logos require administrator ownership and tenant-scoped referenced reads',async()=> {
  await denied(B,"insert into storage.objects(bucket_id,name) values('profile-media',$1)",[logoB]);
  await as(A,"insert into storage.objects(bucket_id,name) values('profile-media',$1)",[logoA]);
  assert.equal(await scalar(B,'select count(*)::int from storage.objects where name=$1',[logoA]),0);
  const w=await scalar(A,'select public.set_workspace_logo($1,$2)',[w1.id,logoA]);assert.equal(w.logo_path,logoA);
  assert.equal(await scalar(B,'select count(*)::int from storage.objects where name=$1',[logoA]),1);
  assert.equal(await scalar(C,'select count(*)::int from storage.objects where name=$1',[logoA]),0);
  await denied(B,'select public.set_workspace_logo($1,$2)',[w1.id,logoA]);
  await denied(C,'select public.set_workspace_logo($1,$2)',[w2.id,logoA]);
  await as(A,'delete from storage.objects where name=$1',[logoA]);
  assert.equal(await scalar(A,'select count(*)::int from storage.objects where name=$1',[logoA]),1);
  await scalar(A,"select public.set_member_role($1,$2,'admin')",[w1.id,B]);
  await as(B,"insert into storage.objects(bucket_id,name) values('profile-media',$1)",[logoB]);
  await scalar(B,'select public.set_workspace_logo($1,$2)',[w1.id,logoB]);
  await as(A,'delete from storage.objects where name=$1',[logoA]);
  assert.equal((await db.query('select count(*)::int n from storage.objects where name=$1',[logoA])).rows[0].n,0);
  await scalar(A,'select public.set_workspace_logo($1,null)',[w1.id]);
  await as(A,'delete from storage.objects where name=$1',[logoB]);
  assert.equal((await db.query('select count(*)::int n from storage.objects where name=$1',[logoB])).rows[0].n,1);
  await as(B,'delete from storage.objects where name=$1',[logoB]);
  assert.equal((await db.query('select count(*)::int n from storage.objects where name=$1',[logoB])).rows[0].n,0);
 });
 await test('archived channels reject new messages',async()=> {
  const s=await scalar(B,"select public.schedule_message(gen_random_uuid(),$1,'archive failure',null,now()+interval '1 minute')",[general]);
  await db.query("update public.scheduled_messages set scheduled_at=now()-interval '1 minute' where id=$1",[s.id]);
  await scalar(A,"select public.update_conversation($1,'general','','',true)",[general]);
  await denied(B,"select public.send_message(gen_random_uuid(),$1,'archived',null)",[general]);
  await db.exec('begin; set local role service_role');
  await db.query('select public.process_scheduled_messages()');await db.exec('commit');
  const failed=(await as(B,'select * from public.scheduled_messages where id=$1',[s.id])).rows[0];
  assert.ok(failed.failed_at);assert.ok(failed.error);assert.equal(failed.sent_at,null);
  await scalar(A,"select public.update_conversation($1,'general','','',false)",[general]);
 });
 await test('ownership transfer preserves exactly one owner',async()=> {
  await denied(B,'select public.transfer_ownership($1,$2)',[w1.id,B]);
  await scalar(A,'select public.transfer_ownership($1,$2)',[w1.id,B]);
  assert.equal(await scalar(B,"select count(*)::int from public.workspace_members where workspace_id=$1 and role='owner'",[w1.id]),1);
  assert.equal(await scalar(B,'select owner_id from public.workspaces where id=$1',[w1.id]),B);
  await scalar(B,'select public.transfer_ownership($1,$2)',[w1.id,A]);
 });
 await test('presence identity and timestamps are assigned only by the database',async()=> {
  await scalar(B,'select public.set_presence($1,false,true)',[general]);
  const p=(await as(A,'select * from public.conversation_presence where conversation_id=$1 and user_id=$2',[general,B])).rows[0];
  assert.equal(p.user_id,B);assert.equal(p.status,'online');
  assert.equal(Date.parse(p.typing_until)-Date.parse(p.last_seen_at),4000);
  await denied(B,"insert into public.conversation_presence(conversation_id,user_id,status) values($1,$2,'online')",[general,A]);
  await denied(B,"update public.conversation_presence set user_id=$1,last_seen_at=now()+interval '1 year' where conversation_id=$2",[A,general]);
  await denied(C,'select public.set_presence($1,false,true)',[general]);
  assert.equal(await scalar(C,'select count(*)::int from public.conversation_presence where conversation_id=$1',[general]),0);
 });
 await test('presence away state clears typing, clear removes only self, TTL hides expired rows',async()=> {
  await scalar(B,'select public.set_presence($1,true,true)',[general]);
  let p=(await as(A,'select * from public.conversation_presence where conversation_id=$1 and user_id=$2',[general,B])).rows[0];
  assert.equal(p.status,'away');assert.equal(p.typing_until,null);
  await scalar(A,'select public.set_presence($1,false,false)',[general]);
  await scalar(B,'select public.clear_presence($1)',[general]);
  assert.equal(await scalar(A,'select count(*)::int from public.conversation_presence where conversation_id=$1 and user_id=$2',[general,A]),1);
  assert.equal(await scalar(A,'select count(*)::int from public.conversation_presence where conversation_id=$1 and user_id=$2',[general,B]),0);
  await scalar(B,'select public.set_presence($1,false,true)',[general]);
  await db.query("update public.conversation_presence set last_seen_at=now()-interval '61 seconds' where conversation_id=$1 and user_id=$2",[general,B]);
  assert.equal(await scalar(A,'select count(*)::int from public.conversation_presence where conversation_id=$1 and user_id=$2',[general,B]),0);
  await scalar(B,'select public.set_presence($1,false,false)',[general]);
 });
 await test('workspace removal immediately revokes reads, writes and topic authorization',async()=> {
  await scalar(A,'select public.remove_member($1,$2)',[w1.id,B]);
  assert.equal(await scalar(B,'select count(*)::int from public.messages where conversation_id=$1',[general]),0);
  assert.equal(await scalar(B,'select count(*)::int from public.conversations where id=$1',[dm.id]),0);
  assert.equal(await scalar(B,'select private.can_join_topic($1)',[await topicFor('conversation',general)]),false);
  assert.equal(await scalar(B,'select count(*)::int from public.saved_messages'),0);
  assert.equal(await scalar(A,'select count(*)::int from public.conversation_presence where conversation_id=$1 and user_id=$2',[general,B]),0);
  assert.equal(await scalar(B,'select count(*)::int from public.thread_subscriptions where thread_id=$1',[discussion.id]),0);
  assert.equal(await scalar(A,'select count(*)::int from storage.objects where name=$1',[avatarB]),0);
  await denied(B,'select public.follow_thread($1,true)',[discussion.id]);
  await denied(B,'select public.save_draft($1,$2,null)',[general,'revoked draft']);
  await denied(B,'select public.set_presence($1,false,false)',[general]);
  await denied(B,"select public.send_message(gen_random_uuid(),$1,'revoked',null)",[general]);
 });

 await test('epoch rotation rejects stale private topics and publishes subsequent activity only to the new topic',async()=> {
  const epochPriv=await scalar(A,"select public.create_conversation($1,'epoch-private','private','',array[]::uuid[])",[w1.id]);
  const old=await topicFor('conversation',epochPriv.id);
  await scalar(A,'select public.add_conversation_member($1,$2)',[epochPriv.id,D]);
  assert.equal(await scalar(D,'select private.can_join_topic($1)',[old]),true);
  await db.exec('truncate realtime.test_broadcasts');
  await scalar(A,'select public.remove_conversation_member($1,$2)',[epochPriv.id,D]);
  const current=await topicFor('conversation',epochPriv.id);assert.notEqual(current,old);
  assert.equal(await scalar(A,'select private.can_join_topic($1)',[old]),false);
  assert.equal(await scalar(A,'select private.can_join_topic($1)',[current]),true);
  assert.equal(await scalar(D,'select private.can_join_topic($1)',[current]),false);
  await scalar(A,"select public.send_message(gen_random_uuid(),$1,'after revocation',null)",[epochPriv.id]);
  const logs=(await db.query('select * from realtime.test_broadcasts where topic=$1',[old])).rows;
  assert.equal(logs.length,1);assert.equal(logs[0].event,'rekey');assert.deepEqual(logs[0].payload,{});
  assert.ok((await db.query("select 1 from realtime.test_broadcasts where topic=$1 and event='change'",[current])).rows.length>0);
  assert.equal(await scalar(A,'select private.can_join_topic($1)',['conversation:'+epochPriv.id]),false);
  await denied(A,'select private.topic_for($1,$2)',['conversation',epochPriv.id]);
 });
 await test('workspace removal rotates every conversation topic and escaped usernames still notify',async()=> {
  const oldWorkspace=await topicFor('workspace',w1.id), oldPublic=await topicFor('conversation',general);
  await scalar(A,'select public.remove_member($1,$2)',[w1.id,D]);
  assert.notEqual(await topicFor('workspace',w1.id),oldWorkspace);assert.notEqual(await topicFor('conversation',general),oldPublic);
  assert.equal(await scalar(A,'select private.can_join_topic($1)',[oldWorkspace]),false);
  assert.equal(await scalar(D,'select private.can_join_topic($1)',[await topicFor('workspace',w1.id)]),false);
  assert.equal((await db.query('select private.body_mentions($1,$2,$3) mentions',['hello @test'+String.fromCharCode(92)+'_writer','test_writer',A])).rows[0].mentions,true);
 });
 await test('anonymous clients cannot read data or invoke mutations',async()=> {
  await db.exec('begin; set local role anon');
  try {await assert.rejects(()=>db.query('select * from public.messages'));} finally {await db.exec('rollback');}
  await db.exec('begin; set local role anon');
  try {await assert.rejects(()=>db.query("select public.create_workspace('intruder')"));} finally {await db.exec('rollback');}
 });
 await test('all public product tables have RLS enabled',async()=> {
  const r=await db.query("select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity");assert.equal(r.rows.length,0);
 });
 await test('public API wrappers never run with definer privileges',async()=> {
  const r=await db.query("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef");assert.equal(r.rows.length,0);
 });
 await test('persistent rate limit blocks excess workspace creation',async()=> {
  // Isolate this fixture from earlier API calls. One transaction fixes now(), so
  // a real wall-clock minute boundary cannot legitimately renew the quota.
  await db.query("delete from private.rate_limits where user_id=$1 and bucket='workspace'",[A]);
  await db.exec('begin');
  try {
   await db.exec('set local role authenticated');
   await db.query("select set_config('request.jwt.claim.sub',$1,true)",[A]);
   for(let i=0;i<5;i++) await db.query('select public.create_workspace($1)',['Rate '+i]);
   const before=(await db.query('select count(*)::int n from public.workspaces')).rows[0].n;
   await db.exec('savepoint quota_attempt');
   await assert.rejects(()=>db.query("select public.create_workspace('too many')"), /Rate limit reached/);
   await db.exec('rollback to savepoint quota_attempt');
   assert.equal((await db.query('select count(*)::int n from public.workspaces')).rows[0].n,before);
   await db.exec('commit');
  } catch(error) {await db.exec('rollback');throw error;}
 });
 console.log(`\n${passed} database authorization and persistence checks passed (PGlite; Supabase schemas stubbed).`);
} finally {await db.close();}

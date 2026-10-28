/** Opt-in real Supabase load exercise. Never creates accounts or guesses a target. */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const e = process.env;
const url = e.TEST_SUPABASE_URL; const key = e.TEST_SUPABASE_KEY;
if (!url || !key || !e.LOAD_CONVERSATION_ID || !e.LOAD_USERS_JSON || e.LOAD_ALLOW_WRITES !== new URL(url).hostname) {
  console.error('Not run. Set TEST_SUPABASE_URL/KEY, LOAD_CONVERSATION_ID, LOAD_USERS_JSON, and LOAD_ALLOW_WRITES to the exact dedicated project hostname.');
  process.exit(2);
}
if (key.startsWith('sb_secret_') || key.split('.').length === 3 && JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'service_role') throw new Error('Use a publishable key; privileged clients invalidate authorization measurements.');
let accounts;
try { accounts = JSON.parse(e.LOAD_USERS_JSON); }
catch { console.error('LOAD_USERS_JSON must be valid JSON. Account values are not logged.'); process.exit(2); }
const seconds = Number(e.LOAD_DURATION_SECONDS ?? 30); const rps = Number(e.LOAD_RPS ?? 2);
if (!Array.isArray(accounts) || accounts.length < 2 || accounts.length > 200 || !accounts.every((account) => typeof account.email === 'string' && typeof account.password === 'string')) throw new Error('Provide 2–200 existing dedicated test accounts.');
if (!Number.isInteger(seconds) || seconds < 5 || seconds > 120 || !Number.isFinite(rps) || rps <= 0 || rps > 10) throw new Error('Use 5–120 seconds and a global send rate of at most 10 messages/second.');
const clients = []; const channels = []; const starts = new Map(); const acknowledged = []; const delivered = []; const failures = [];
const observations = new Set(); let persisted = 0; let duplicateEvents = 0;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const percentile = (values, p) => values.length ? Math.round([...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1]) : null;
try {
  for (const account of accounts) {
    const client = createClient(url, key, { auth: { persistSession: false } });
    const login = await client.auth.signInWithPassword(account); if (login.error) throw new Error('A test account could not sign in.');
    const access = await client.from('conversations').select('id,realtime_epoch').eq('id', e.LOAD_CONVERSATION_ID).maybeSingle();
    if (access.error || !access.data) throw new Error('Every test account must already belong to the target conversation.');
    clients.push({ client, userId: login.data.user.id });
    const channel = client.channel(`conversation:${e.LOAD_CONVERSATION_ID}:${access.data.realtime_epoch}`, { config: { private: true } }); channels.push(channel);
    channel.on('broadcast', { event: 'change' }, async ({ payload }) => {
      if (payload?.table !== 'messages' || payload?.operation !== 'INSERT' || !payload?.message_id) return;
      const start = starts.get(payload.message_id); if (!start || start.author === login.data.user.id) return;
      const observation = `${login.data.user.id}:${payload.message_id}`;
      if (observations.has(observation)) { duplicateEvents += 1; return; } observations.add(observation);
      const read = await client.from('messages').select('id').eq('id', payload.message_id).maybeSingle();
      if (read.error || !read.data) { failures.push('peer_read'); return; }
      delivered.push(performance.now() - start.time);
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('A real-time subscription timed out.')), 15_000);
      channel.subscribe((status) => { if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(); } else if (status === 'CHANNEL_ERROR') { clearTimeout(timer); reject(new Error('A real-time subscription was rejected.')); } });
    });
  }
  const count = Math.floor(seconds * rps); const inFlight = new Set(); const runId = randomUUID(); const began = performance.now();
  for (let index = 0; index < count; index += 1) {
    const wait = began + index * (1000 / rps) - performance.now(); if (wait > 0) await pause(wait);
    if (inFlight.size >= 20) await Promise.race(inFlight);
    const { client, userId } = clients[index % clients.length]; const id = randomUUID(); const started = performance.now(); starts.set(id, { time: started, author: userId });
    const work = client.rpc('send_message', { p_id: id, p_conversation_id: e.LOAD_CONVERSATION_ID, p_body: `[load ${runId}] ${index + 1}`, p_parent_id: null }).then(({ error }) => {
      if (error) failures.push('persist'); else { persisted += 1; acknowledged.push(performance.now() - started); }
    }).catch(() => failures.push('transport')).finally(() => inFlight.delete(work)); inFlight.add(work);
  }
  await Promise.all(inFlight); const expected = persisted * (clients.length - 1); const drainUntil = Date.now() + 10_000;
  while (delivered.length < expected && Date.now() < drainUntil) await pause(100);
  const p95Ack = percentile(acknowledged, .95); const p95Peer = percentile(delivered, .95);
  const pass = failures.length === 0 && delivered.length === expected && p95Ack !== null && p95Ack < 800 && p95Peer !== null && p95Peer < 1500;
  console.log(JSON.stringify({ runId, accounts: clients.length, seconds, globalMessagesPerSecond: rps, attempted: count, persisted, peerObservations: delivered.length, expectedPeerObservations: expected, duplicateEvents, failures: failures.length, ackMs: { p50: percentile(acknowledged, .5), p95: p95Ack }, peerVisibleMs: { p50: percentile(delivered, .5), p95: p95Peer }, budgets: { p95AckMs: 800, p95PeerMs: 1500 }, pass, limits: 'Single load-generator host; no geographic coverage or uptime guarantee. [load] records remain in the dedicated test project.' }, null, 2));
  if (!pass) process.exitCode = 1;
} catch {
  console.error('Load exercise stopped because authentication, membership, subscription, or transport setup failed. Inspect the dedicated project logs; credentials are never logged.');
  process.exitCode = 1;
} finally {
  await Promise.allSettled(clients.map(async ({ client }) => { await client.removeAllChannels(); await client.auth.stopAutoRefresh(); }));
}

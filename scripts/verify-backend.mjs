import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
assert(url?.startsWith("https://"), "Configure the dedicated HTTPS Supabase URL.");
assert(key?.startsWith("sb_publishable_"), "Use a public publishable key.");
const headers = { apikey: key };
const checks = [];
async function check(name, action) {
  try { const detail = await action(); checks.push({ name, passed: true, ...detail }); }
  catch (error) { checks.push({ name, passed: false, error: error.message }); }
}
await check("hosted Auth health", async () => {
  const response = await fetch(url + "/auth/v1/health", { headers, signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200);
  return { status: response.status };
});
await check("email authentication settings", async () => {
  const response = await fetch(url + "/auth/v1/settings", { headers, signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200);
  const settings = await response.json();
  assert.equal(settings.external?.email, true);
  assert.equal(settings.mailer_autoconfirm, false, "Email confirmation must remain enabled.");
  return { emailEnabled: true, confirmationRequired: true };
});
await check("anonymous tenant reads denied", async () => {
  const response = await fetch(url + "/rest/v1/messages?select=id&limit=1", { headers, signal: AbortSignal.timeout(15000) });
  assert([401,403].includes(response.status), "Anonymous messages access unexpectedly allowed: " + response.status);
  return { status: response.status };
});
await check("anonymous workspace creation denied", async () => {
  const response = await fetch(url + "/rest/v1/rpc/create_workspace", {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ p_name: "unauthorized" }), signal: AbortSignal.timeout(15000),
  });
  assert([401,403].includes(response.status), "Anonymous RPC unexpectedly allowed: " + response.status);
  return { status: response.status };
});
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { timeout: 10000 } });
async function subscription(privateChannel) {
  const channel = client.channel("relay-config-check:" + randomUUID(), { config: { private: privateChannel } });
  try {
    return await new Promise((resolve) => {
      const timer = setTimeout(() => resolve("TIMEOUT"), 15000);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timer); resolve(status);
        }
      });
    });
  } finally { await client.removeChannel(channel); }
}
await check("anonymous private Realtime denied", async () => {
  const status = await subscription(true);
  assert.equal(status, "CHANNEL_ERROR", "Expected an explicit authorization denial: " + status);
  return { status };
});
const publicChannelStatus = await subscription(false);
client.realtime.disconnect();
const report = {
  checkedAt: new Date().toISOString(), projectRef: new URL(url).hostname.split(".")[0],
  checks, publicChannelsAllowed: publicChannelStatus === "SUBSCRIBED", publicChannelStatus,
  note: "No user accounts, workspaces, messages or files were created. Authenticated collaboration remains untested.",
};
await mkdir("docs/verification", { recursive: true });
await writeFile("docs/verification/supabase-connectivity.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
process.exitCode = checks.every(c => c.passed) ? 0 : 1;

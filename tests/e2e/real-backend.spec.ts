import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const env = process.env;
const configured = Boolean(
  env.TEST_SUPABASE_URL &&
  env.TEST_SUPABASE_KEY &&
  env.TEST_USER_A_EMAIL &&
  env.TEST_USER_A_PASSWORD &&
  env.TEST_USER_B_EMAIL &&
  env.TEST_USER_B_PASSWORD &&
  env.TEST_ALLOW_WRITES === "true",
);
const marker = `relaytest${randomUUID().replaceAll("-", "")}`;
const channelName = `test-${marker.slice(-12)}`;
let a: SupabaseClient;
let b: SupabaseClient;
let c: SupabaseClient | undefined;
let aId = "";
let bId = "";
let workspaceId = "";
let conversationId = "";
let messageId = "";
let contextA: BrowserContext;
let contextB: BrowserContext;
let pageA: Page;
let pageB: Page;
const uploads: { client: SupabaseClient; path: string }[] = [];
// Password-bearing login actions must never enter trace/video artifacts.
test.use({ trace: "off", video: "off" });

async function rpc<T>(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  expect(error, `${name} must succeed`).toBeNull();
  return data as T;
}
async function signIn(page: Page, email: string, password: string) {
  await page.goto("/");
  await page.getByLabel("Work email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Sign in to Relay", exact: true })
    .click();
  await expect(
    page.getByRole("navigation", { name: "Workspaces", exact: true }),
  ).toBeVisible({ timeout: 20_000 });
}
const appPath = () =>
  `/?workspace=${workspaceId}&conversation=${conversationId}`;
const mainRow = (page: Page, id = messageId) =>
  page.locator(`.conversation #message-${id}`);

test.describe("real Supabase collaboration and isolation", () => {
  test.describe.configure({ mode: "serial", timeout: 90_000 });
  test.skip(
    !configured,
    "Requires dedicated backend, two existing test accounts, and TEST_ALLOW_WRITES=true. No users are provisioned.",
  );
  test.beforeAll(async ({ browser }, testInfo) => {
    expect(
      env.TEST_SUPABASE_KEY!.startsWith("sb_secret_"),
      "Use a publishable key, never a privileged key.",
    ).toBe(false);
    if (env.TEST_SUPABASE_KEY!.split(".").length === 3) {
      const claim = JSON.parse(
        Buffer.from(
          env.TEST_SUPABASE_KEY!.split(".")[1],
          "base64url",
        ).toString(),
      ) as { role?: string };
      expect(claim.role).not.toBe("service_role");
    }
    a = createClient(env.TEST_SUPABASE_URL!, env.TEST_SUPABASE_KEY!, {
      auth: { persistSession: false },
    });
    b = createClient(env.TEST_SUPABASE_URL!, env.TEST_SUPABASE_KEY!, {
      auth: { persistSession: false },
    });
    const authA = await a.auth.signInWithPassword({
      email: env.TEST_USER_A_EMAIL!,
      password: env.TEST_USER_A_PASSWORD!,
    });
    const authB = await b.auth.signInWithPassword({
      email: env.TEST_USER_B_EMAIL!,
      password: env.TEST_USER_B_PASSWORD!,
    });
    expect(authA.error).toBeNull();
    expect(authB.error).toBeNull();
    aId = authA.data.user!.id;
    bId = authB.data.user!.id;
    expect(aId).not.toBe(bId);
    if (env.TEST_USER_C_EMAIL && env.TEST_USER_C_PASSWORD) {
      c = createClient(env.TEST_SUPABASE_URL!, env.TEST_SUPABASE_KEY!, {
        auth: { persistSession: false },
      });
      const authC = await c.auth.signInWithPassword({
        email: env.TEST_USER_C_EMAIL,
        password: env.TEST_USER_C_PASSWORD,
      });
      expect(authC.error).toBeNull();
      expect([aId, bId]).not.toContain(authC.data.user!.id);
    }
    const baseURL = String(
      testInfo.project.use.baseURL || "http://127.0.0.1:3000",
    );
    contextA = await browser.newContext({ baseURL });
    contextB = await browser.newContext({ baseURL });
    pageA = await contextA.newPage();
    pageB = await contextB.newPage();
    await signIn(pageA, env.TEST_USER_A_EMAIL!, env.TEST_USER_A_PASSWORD!);
    await signIn(pageB, env.TEST_USER_B_EMAIL!, env.TEST_USER_B_PASSWORD!);
  });
  test.afterAll(async () => {
    for (const upload of uploads)
      await upload.client.storage.from("attachments").remove([upload.path]);
    // Keep the named [e2e] workspace for failure inspection; never delete user accounts.
    await Promise.allSettled([
      contextA?.close(),
      contextB?.close(),
      a?.removeAllChannels(),
      b?.removeAllChannels(),
      c?.removeAllChannels(),
    ]);
  });

  test("creates a workspace through the UI and joins a teammate with a secure invitation", async () => {
    await pageA
      .getByRole("navigation", { name: "Workspaces", exact: true })
      .getByRole("button", { name: "Create a workspace", exact: true })
      .click();
    const create = pageA.getByRole("dialog", {
      name: "A fresh space for your team",
      exact: true,
    });
    await create
      .getByLabel("Workspace name", { exact: true })
      .fill(`[e2e] ${marker}`);
    await create
      .getByRole("button", { name: "Create workspace", exact: true })
      .click();
    await expect(create).not.toBeVisible();
    const result = await a
      .from("workspaces")
      .select("id")
      .eq("name", `[e2e] ${marker}`)
      .single();
    expect(result.error).toBeNull();
    workspaceId = result.data!.id;
    await pageA.locator(".invite-team").click();
    const invite = pageA.getByRole("dialog", {
      name: "Good work is better together.",
      exact: true,
    });
    await invite
      .getByRole("button", {
        name: "Create secure invitation link",
        exact: true,
      })
      .click();
    const url = await invite
      .getByLabel("Invitation link", { exact: true })
      .inputValue();
    const token = new URL(url).searchParams.get("invite");
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    await invite.getByRole("button", { name: "Close dialog" }).click();
    await pageB.goto(`/?invite=${token}`);
    await pageB
      .getByRole("dialog", { name: "Your team is expecting you.", exact: true })
      .getByRole("button", { name: "Accept invitation", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await b
              .from("workspace_members")
              .select("role")
              .eq("workspace_id", workspaceId)
              .eq("user_id", bId)
              .maybeSingle()
          ).data?.role,
      )
      .toBe("member");
    await pageA
      .getByRole("button", { name: "Create channel", exact: true })
      .click();
    const channel = pageA.getByRole("dialog", {
      name: "Create a channel",
      exact: true,
    });
    await channel.getByLabel("Channel name", { exact: true }).fill(channelName);
    await channel
      .getByRole("button", { name: "Create channel", exact: true })
      .click();
    await expect(channel).not.toBeVisible();
    const found = await a
      .from("conversations")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("name", channelName)
      .single();
    expect(found.error).toBeNull();
    conversationId = found.data!.id;
    await pageB.goto(appPath());
    await expect(pageB.locator(".conversation-header h1")).toHaveText(
      channelName,
    );
  });

  test("persists a message, delivers it to another browser, edits, reacts, threads, saves and searches", async () => {
    await pageA.goto(appPath());
    await pageB.goto(appPath());
    await expect(pageA.locator(".connection-status")).toHaveText("Connected", {
      timeout: 15_000,
    });
    await expect(pageB.locator(".connection-status")).toHaveText("Connected", {
      timeout: 15_000,
    });
    const body = `Persistent conversation ${marker}`;
    await pageA
      .getByLabel(`Message #${channelName}`, { exact: true })
      .fill(body);
    await pageA
      .getByLabel(`Message #${channelName}`, { exact: true })
      .press("Enter");
    // This assertion must pass over the live socket: no navigation or refresh in peer context.
    await expect(
      pageB.locator(".conversation .message-row").filter({ hasText: body }),
    ).toBeVisible({ timeout: 15_000 });
    const persisted = await a
      .from("messages")
      .select("id,seq")
      .eq("conversation_id", conversationId)
      .eq("body", body)
      .single();
    expect(persisted.error).toBeNull();
    messageId = persisted.data!.id;
    expect(persisted.data!.seq).toBeGreaterThan(0);
    await rpc(a, "send_message", {
      p_id: messageId,
      p_conversation_id: conversationId,
      p_body: body,
      p_parent_id: null,
    });
    const duplicates = await a
      .from("messages")
      .select("id", { count: "exact" })
      .eq("id", messageId);
    expect(duplicates.count).toBe(1);
    await mainRow(pageA).hover();
    await mainRow(pageA)
      .getByRole("button", { name: "More message actions", exact: true })
      .click();
    await mainRow(pageA)
      .getByRole("button", { name: "Edit message", exact: true })
      .click();
    const edit = pageA.getByRole("dialog", {
      name: "Edit your message",
      exact: true,
    });
    await edit
      .getByLabel("Message", { exact: true })
      .fill(`Edited conversation ${marker}`);
    await edit
      .getByRole("button", { name: "Save message", exact: true })
      .click();
    await expect(mainRow(pageB).locator(".markdown")).toContainText(
      `Edited conversation ${marker}`,
      { timeout: 15_000 },
    );
    await mainRow(pageB).hover();
    await mainRow(pageB)
      .getByRole("button", { name: "React to message", exact: true })
      .click();
    await mainRow(pageB)
      .getByRole("button", { name: "React 👍", exact: true })
      .click();
    await expect(
      mainRow(pageA).getByRole("button", {
        name: "👍, 1 reaction",
        exact: true,
      }),
    ).toBeVisible({ timeout: 15_000 });
    await mainRow(pageB)
      .getByRole("button", { name: "Reply in thread", exact: true })
      .click();
    await pageB
      .getByLabel("Thread reply", { exact: true })
      .fill(`Thread reply ${marker}`);
    await pageB.getByLabel("Thread reply", { exact: true }).press("Enter");
    await expect(
      mainRow(pageA).getByRole("button", { name: /1 reply/ }),
    ).toBeVisible({ timeout: 15_000 });
    await mainRow(pageA)
      .getByRole("button", { name: /1 reply/ })
      .click();
    await expect(pageA.locator(".thread-body")).toContainText(
      `Thread reply ${marker}`,
    );
    await pageA
      .getByRole("button", { name: "Close thread", exact: true })
      .click();
    await pageB
      .getByRole("button", { name: "Close thread", exact: true })
      .click();
    await mainRow(pageA).hover();
    await mainRow(pageA)
      .getByRole("button", { name: "Save for later", exact: true })
      .click();
    await pageA
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .getByRole("button", { name: "Later", exact: true })
      .click();
    await expect(pageA.locator(".saved-card")).toContainText(marker);
    const saved = await a
      .from("saved_messages")
      .select("message_id")
      .eq("message_id", messageId);
    expect(saved.data).toHaveLength(1);
    await pageA.keyboard.press("Control+k");
    const search = pageA.getByRole("dialog", {
      name: "Find the conversation",
      exact: true,
    });
    await search.getByLabel("Search workspace", { exact: true }).fill(marker);
    await search.getByRole("button", { name: "Search", exact: true }).click();
    await expect(
      search
        .locator(".search-result")
        .filter({ hasText: "Edited conversation" }),
    ).toBeVisible();
    await search
      .locator(".search-result")
      .filter({ hasText: "Edited conversation" })
      .click();
    await expect(mainRow(pageA)).toContainText(marker);
  });

  test("uploads a real document and grants only authorized signed access", async ({
    request,
  }) => {
    await pageB.goto(appPath());
    const filename = `notes-${marker}.txt`;
    const content = `Real attachment fixture ${marker}\n`;
    await pageB.locator(".conversation input[type=file]").setInputFiles({
      name: filename,
      mimeType: "text/plain",
      buffer: Buffer.from(content),
    });
    await pageB
      .getByLabel(`Message #${channelName}`, { exact: true })
      .fill(`Attached notes ${marker}`);
    await pageB
      .getByLabel(`Message #${channelName}`, { exact: true })
      .press("Enter");
    await expect(
      pageB.locator(".conversation .attachment").filter({ hasText: filename }),
    ).toBeVisible({ timeout: 20_000 });
    const attachment = await a
      .from("attachments")
      .select("*")
      .eq("conversation_id", conversationId)
      .eq("name", filename)
      .single();
    expect(attachment.error).toBeNull();
    uploads.push({ client: b, path: attachment.data!.path });
    const signed = await a.storage
      .from("attachments")
      .createSignedUrl(attachment.data!.path, 60);
    expect(signed.error).toBeNull();
    const response = await request.get(signed.data!.signedUrl);
    expect(response.ok()).toBe(true);
    expect(await response.text()).toBe(content);
    if (c) {
      const denied = await c.storage
        .from("attachments")
        .createSignedUrl(attachment.data!.path, 60);
      expect(denied.error).not.toBeNull();
    }
  });

  test("enforces private channel, DM, file and authenticated presence authorization", async () => {
    const privateChannel = await rpc<{ id: string }>(a, "create_conversation", {
      p_workspace_id: workspaceId,
      p_name: `private-${marker.slice(-10)}`,
      p_kind: "private",
      p_description: "",
      p_member_ids: [],
    });
    const privateId = randomUUID();
    await rpc(a, "send_message", {
      p_id: privateId,
      p_conversation_id: privateChannel.id,
      p_body: `Private ${marker}`,
      p_parent_id: null,
    });
    const invisible = await b.from("messages").select("id").eq("id", privateId);
    expect(invisible.error).toBeNull();
    expect(invisible.data).toEqual([]);
    const deniedSend = await b.rpc("send_message", {
      p_id: randomUUID(),
      p_conversation_id: privateChannel.id,
      p_body: "Forbidden",
      p_parent_id: null,
    });
    expect(deniedSend.error?.code).toBe("42501");
    const deniedEdit = await b.rpc("edit_message", {
      p_id: privateId,
      p_body: "Forbidden edit",
    });
    expect(deniedEdit.error?.code).toBe("42501");
    const authorized = await a
      .from("conversations")
      .select("realtime_epoch")
      .eq("id", privateChannel.id)
      .single();
    expect(authorized.error).toBeNull();
    const topic = b.channel(
      `conversation:${privateChannel.id}:${authorized.data!.realtime_epoch}`,
      {
        config: { private: true },
      },
    );
    const status = await new Promise<string>((resolve) => {
      const timeout = setTimeout(() => resolve("TEST_TIMEOUT"), 15_000);
      topic.subscribe((value) => {
        if (value === "CHANNEL_ERROR" || value === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve(value);
        }
      });
    });
    expect(
      status,
      "Unauthorized subscription must be rejected, not merely time out.",
    ).toBe("CHANNEL_ERROR");
    await b.removeChannel(topic);
    const path = `${privateChannel.id}/${aId}/${randomUUID()}/private.txt`;
    const upload = await a.storage
      .from("attachments")
      .upload(path, new Blob([marker], { type: "text/plain" }), {
        contentType: "text/plain",
      });
    expect(upload.error).toBeNull();
    uploads.push({ client: a, path });
    const metadata = await a.from("attachments").insert({
      id: randomUUID(),
      conversation_id: privateChannel.id,
      message_id: privateId,
      uploaded_by: aId,
      path,
      name: "private.txt",
      size: Buffer.byteLength(marker),
      mime_type: "text/plain",
    });
    expect(metadata.error).toBeNull();
    expect(
      (await b.storage.from("attachments").createSignedUrl(path, 60)).error,
    ).not.toBeNull();
    await rpc(a, "set_presence", {
      p_conversation_id: privateChannel.id,
      p_away: false,
      p_typing: true,
    });
    const forged = await b.from("conversation_presence").insert({
      conversation_id: privateChannel.id,
      user_id: aId,
      status: "online",
      last_seen_at: new Date().toISOString(),
    });
    expect(forged.error).not.toBeNull();
    const deniedPresence = await b.rpc("set_presence", {
      p_conversation_id: privateChannel.id,
      p_away: false,
      p_typing: true,
    });
    expect(deniedPresence.error?.code).toBe("42501");
    await rpc(a, "add_conversation_member", {
      p_conversation_id: privateChannel.id,
      p_user_id: bId,
    });
    expect(
      (await b.from("messages").select("id").eq("id", privateId)).data,
    ).toHaveLength(1);
    await rpc(a, "remove_conversation_member", {
      p_conversation_id: privateChannel.id,
      p_user_id: bId,
    });
    expect(
      (await b.from("messages").select("id").eq("id", privateId)).data,
    ).toEqual([]);
    expect(
      (await b.storage.from("attachments").createSignedUrl(path, 60)).error,
    ).not.toBeNull();
    const dm = await rpc<{ id: string }>(a, "create_conversation", {
      p_workspace_id: workspaceId,
      p_name: "Direct message",
      p_kind: "dm",
      p_description: "",
      p_member_ids: [bId],
    });
    const duplicate = await rpc<{ id: string }>(a, "create_conversation", {
      p_workspace_id: workspaceId,
      p_name: "Direct message",
      p_kind: "dm",
      p_description: "",
      p_member_ids: [bId],
    });
    expect(duplicate.id).toBe(dm.id);
    if (c) {
      expect(
        (await c.from("workspaces").select("id").eq("id", workspaceId)).data,
      ).toEqual([]);
      expect(
        (await c.from("conversations").select("id").eq("id", dm.id)).data,
      ).toEqual([]);
      expect(
        (
          await c
            .from("messages")
            .select("id")
            .eq("conversation_id", conversationId)
        ).data,
      ).toEqual([]);
    }
  });

  test("recovers persisted traffic after a browser network interruption", async () => {
    await pageB.goto(appPath());
    await expect(pageB.locator(".connection-status")).toHaveText("Connected", {
      timeout: 15_000,
    });
    await contextB.setOffline(true);
    const body = `Recovered after outage ${marker}`;
    await rpc(a, "send_message", {
      p_id: randomUUID(),
      p_conversation_id: conversationId,
      p_body: body,
      p_parent_id: null,
    });
    await contextB.setOffline(false);
    await expect(
      pageB.locator(".conversation .message-row").filter({ hasText: body }),
    ).toBeVisible({ timeout: 30_000 });
  });
});

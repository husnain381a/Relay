import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createCollectionQueries } from "../src/lib/relay/collections";
import { createQueries } from "../src/lib/relay/queries";

// Read-only schema-resolution checks. Anonymous access must remain denied.
// Run explicitly with the configured project's public key; no accounts or data writes.
const enabled = process.env.RELAY_VERIFY_HOSTED_QUERIES === "1";
const workspace = "00000000-0000-4000-8000-000000000001";

describe.skipIf(!enabled)("hosted PostgREST relationship resolution", () => {
  const client = enabled
    ? createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      )
    : undefined;
  const factory = () => client!;
  const queries = createQueries(factory);
  const collections = createCollectionQueries(factory);

  it("reproduces ambiguity in the former saved-message workspace embed", async () => {
    const { error } = await client!
      .from("saved_messages")
      .select(
        "message_id,message:messages!inner(conversation:conversations!inner(workspace_id))",
      )
      .limit(0);
    expect(error?.code).toBe("PGRST201");
    expect(error?.message).toContain("'messages' and 'conversations'");
  });

  for (const [name, action] of [
    ["workspace startup saved IDs", () => collections.savedIds(workspace)],
    ["saved message page", () => collections.savedPage(workspace)],
    ["saved messages", () => queries.saved(workspace)],
    ["pinned messages", () => queries.pins(workspace)],
    ["scheduled message page", () => collections.scheduledPage(workspace)],
    ["scheduled messages", () => queries.scheduled(workspace)],
    ["files page", () => collections.filesPage(workspace)],
    ["files", () => queries.files(workspace)],
    ["message history", () => queries.messages(workspace)],
  ] as const) {
    it(
      name + " resolves its joins and then denies anonymous reads",
      async () => {
        await expect(action()).rejects.toMatchObject({ code: "42501" });
      },
    );
  }
});

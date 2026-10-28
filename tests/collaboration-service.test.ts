import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createCollaboration } from "../src/lib/relay/collaboration";
const conversationId = "00000000-0000-4000-8000-000000000001";
const threadId = "00000000-0000-4000-8000-000000000002";
function service() {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return {
        data: name === "save_draft" ? { body: args.p_body } : null,
        error: null,
      };
    },
  } as unknown as SupabaseClient;
  return { api: createCollaboration(() => client), calls };
}
describe("draft and thread RPC contracts", () => {
  it("preserves unfinished draft whitespace and distinguishes a thread draft from the channel draft", async () => {
    const { api, calls } = service();
    await api.saveDraft(conversationId, "  unfinished\n", threadId);
    await api.clearDraft(conversationId);
    expect(calls).toEqual([
      {
        name: "save_draft",
        args: {
          p_conversation_id: conversationId,
          p_body: "  unfinished\n",
          p_parent_id: threadId,
        },
      },
      {
        name: "clear_draft",
        args: { p_conversation_id: conversationId, p_parent_id: null },
      },
    ]);
  });
  it("never accepts a caller-specified user identifier for thread or draft writes", async () => {
    const { api, calls } = service();
    await api.followThread(threadId, false);
    await api.markThreadRead(threadId, 12);
    expect(calls.every((call) => !("p_user_id" in call.args))).toBe(true);
    expect(calls[1].args).toEqual({ p_thread_id: threadId, p_seq: 12 });
  });
  it("rejects oversized drafts and unsafe read cursors before the backend", async () => {
    const { api, calls } = service();
    await expect(
      api.saveDraft(conversationId, "x".repeat(12001)),
    ).rejects.toThrow();
    await expect(
      api.markThreadRead(threadId, Number.MAX_SAFE_INTEGER + 1),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

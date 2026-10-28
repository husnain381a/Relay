import { describe, expect, it } from "vitest";
import {
  failMessage,
  groupReactions,
  optimisticMessage,
  reconcileMessages,
  recoverMessages,
} from "../src/lib/messages";
import type { Message, Profile } from "../src/lib/types";

const profile: Profile = {
  id: "00000000-0000-4000-8000-000000000001",
  display_name: "Test user",
  username: "test",
  avatar_url: null,
  status: "",
  status_emoji: "",
  title: "",
  bio: "",
  dnd_until: null,
};
function row(id: string, seq: number, body = "Persisted"): Message {
  return {
    id,
    seq,
    conversation_id: "00000000-0000-4000-8000-000000000002",
    author_id: profile.id,
    body,
    parent_id: null,
    created_at: "2026-10-28T10:00:00.000Z",
    edited_at: null,
    deleted_at: null,
    author: profile,
    reactions: [],
    attachments: [],
    delivery: "sent",
  };
}

describe("message delivery recovery", () => {
  it("deduplicates concurrent HTTP acknowledgment and websocket invalidation by client UUID", () => {
    const pending = optimisticMessage(
      {
        id: "same-id",
        conversationId: row("", 1).conversation_id,
        body: "Hello",
      },
      profile,
    );
    const persisted = row("same-id", 7, "Hello");
    const result = reconcileMessages(
      reconcileMessages([pending], [persisted]),
      [persisted],
    );
    expect(result).toHaveLength(1);
    expect(result[0].seq).toBe(7);
    expect(result[0].delivery).toBe("sent");
  });
  it("preserves database ordering when requests finish out of order", () => {
    const result = reconcileMessages(
      [row("third", 9), row("first", 2)],
      [row("second", 6)],
    );
    expect(result.map((m) => m.id)).toEqual(["first", "second", "third"]);
  });
  it("does not turn an acknowledged send into a failure after a late timeout", () => {
    expect(failMessage([row("id", 4)], "id", "timed out")[0].delivery).toBe(
      "sent",
    );
  });
  it("does not replace an acknowledged send with a delayed optimistic render", () => {
    const pending = optimisticMessage(
      { id: "id", conversationId: row("", 1).conversation_id, body: "Hello" },
      profile,
    );
    expect(reconcileMessages([row("id", 4)], [pending])[0].delivery).toBe(
      "sent",
    );
  });
  it("preserves failed unsent messages while replacing a stale persisted window on reconnect", () => {
    const failed = {
      ...row("unsent", Number.MAX_SAFE_INTEGER),
      delivery: "failed" as const,
      error: "offline",
    };
    const result = recoverMessages(
      [row("stale", 1), failed],
      [row("fresh", 11)],
    );
    expect(result.map((m) => m.id)).toEqual(["fresh", "unsent"]);
    expect(result[1].error).toBe("offline");
  });
  it("never resurrects a soft-deleted message when an older read resolves late", () => {
    const deleted = {
      ...row("id", 4, ""),
      deleted_at: "2026-10-28T10:05:00.000Z",
    };
    const result = reconcileMessages([deleted], [row("id", 4)]);
    expect(result[0].deleted_at).toBe(deleted.deleted_at);
    expect(result[0].body).toBe("");
  });
  it("does not overwrite a newer edit with an older response", () => {
    const edited = {
      ...row("id", 4, "New"),
      edited_at: "2026-10-28T10:05:00.000Z",
    };
    expect(reconcileMessages([edited], [row("id", 4, "Old")])[0].body).toBe(
      "New",
    );
  });
  it("keeps reaction ownership separate from aggregate counts", () => {
    const groups = groupReactions(
      [
        { message_id: "id", user_id: profile.id, emoji: "👍" },
        { message_id: "id", user_id: "other", emoji: "👍" },
        { message_id: "id", user_id: "other", emoji: "🎉" },
      ],
      profile.id,
    );
    expect(groups).toEqual([
      { emoji: "👍", count: 2, mine: true },
      { emoji: "🎉", count: 1, mine: false },
    ]);
  });
});

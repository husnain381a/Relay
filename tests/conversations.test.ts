import { describe, expect, it } from "vitest";
import {
  conversationDisplayName,
  type ConversationWithParticipants,
} from "../src/lib/conversations";
const conversation: ConversationWithParticipants = {
  id: "c",
  workspace_id: "w",
  name: "Bob",
  kind: "dm",
  description: "",
  topic: "",
  created_by: "alice",
  archived_at: null,
  created_at: "",
  participants: [
    { user_id: "alice", profile: { display_name: "Alice" } },
    { user_id: "bob", profile: { display_name: "Bob" } },
  ],
};
describe("recipient-relative DM names", () => {
  it("shows the other person to each participant rather than the creator name", () => {
    expect(conversationDisplayName(conversation, "alice").name).toBe("Bob");
    expect(conversationDisplayName(conversation, "bob").name).toBe("Alice");
  });
  it("derives group names without including self and caps long labels", () => {
    expect(
      conversationDisplayName(
        {
          ...conversation,
          participants: [
            ...conversation.participants!,
            { user_id: "carol", profile: { display_name: "Carol" } },
          ],
        },
        "bob",
      ).name,
    ).toBe("Alice, Carol");
    expect(
      conversationDisplayName(
        {
          ...conversation,
          participants: [
            { user_id: "bob", profile: { display_name: "B".repeat(100) } },
          ],
        },
        "alice",
      ).name,
    ).toHaveLength(80);
  });
  it("keeps authored channel names unchanged", () => {
    expect(
      conversationDisplayName(
        { ...conversation, kind: "private", name: "design" },
        "alice",
      ).name,
    ).toBe("design");
  });
});

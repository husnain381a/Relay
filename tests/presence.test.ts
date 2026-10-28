import { describe, expect, it } from "vitest";
import { resolvePresence, type PresenceRow } from "../src/lib/presence";
const now = Date.parse("2026-10-28T10:00:00.000Z");
const row: PresenceRow = {
  conversation_id: "conversation",
  user_id: "peer",
  status: "online",
  last_seen_at: new Date(now - 1000).toISOString(),
  typing_until: new Date(now + 3000).toISOString(),
};
describe("server-authenticated presence expiry", () => {
  it("only includes nonexpired database rows and excludes own typing indicator", () => {
    const result = resolvePresence(
      [
        row,
        { ...row, user_id: "self" },
        {
          ...row,
          user_id: "stale",
          last_seen_at: new Date(now - 60_000).toISOString(),
        },
      ],
      now,
      "self",
    );
    expect(result.members.map((m) => m.userId)).toEqual(["peer", "self"]);
    expect(result.typing).toEqual(["peer"]);
    expect(result.nextExpirationAt).toBe(now + 3000);
  });
  it("expires typing from cached state without network polling", () => {
    const result = resolvePresence([row], now + 3001, "self");
    expect(result.typing).toEqual([]);
    expect(result.members).toHaveLength(1);
    expect(result.nextExpirationAt).toBe(now + 59_000);
  });
  it("expires disconnected users after sixty seconds", () => {
    expect(resolvePresence([row], now + 59_001, "self")).toEqual({
      members: [],
      typing: [],
      nextExpirationAt: null,
    });
  });
  it("preserves authenticated away state and ignores invalid timestamps", () => {
    expect(
      resolvePresence(
        [
          { ...row, status: "away" },
          { ...row, user_id: "invalid", last_seen_at: "bad-date" },
        ],
        now,
        "self",
      ).members,
    ).toEqual([{ userId: "peer", status: "away", onlineAt: row.last_seen_at }]);
  });
});

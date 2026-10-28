import { describe, expect, it } from "vitest";
import {
  conversationInput,
  MAX_UPLOAD_BYTES,
  messageInput,
  profilePatch,
  safeRedirect,
  scheduleInput,
  validateUpload,
} from "../src/lib/validation";

const id = "00000000-0000-4000-8000-000000000001";
describe("input and boundary safety", () => {
  it.each([
    "https://attacker.test",
    "//attacker.test",
    "/\\attacker.test",
    "/\nattacker",
    "javascript:alert(1)",
    null,
  ])("rejects external or ambiguous auth redirect %s", (value) => {
    expect(safeRedirect(value)).toBe("/");
  });
  it("allows a local deep link including a query and anchor", () => {
    expect(safeRedirect("/?workspace=a&channel=b#message-c")).toBe(
      "/?workspace=a&channel=b#message-c",
    );
  });
  it("rejects blank messages, malformed identifiers, and unbounded content", () => {
    expect(
      messageInput.safeParse({ id, conversationId: id, body: "  " }).success,
    ).toBe(false);
    expect(
      messageInput.safeParse({
        id: "../private",
        conversationId: id,
        body: "hi",
      }).success,
    ).toBe(false);
    expect(
      messageInput.safeParse({
        id,
        conversationId: id,
        body: "x".repeat(12001),
      }).success,
    ).toBe(false);
  });
  it("preserves markdown as inert text for the markdown renderer, with no HTML interpretation here", () => {
    expect(
      messageInput.parse({
        id,
        conversationId: id,
        body: "<script>alert(1)</script>",
      }).body,
    ).toBe("<script>alert(1)</script>");
  });
  it("bounds DM participant input independently of UI controls", () => {
    expect(
      conversationInput.safeParse({
        workspaceId: id,
        name: "Team",
        kind: "dm",
        memberIds: Array(51).fill(id),
      }).success,
    ).toBe(false);
  });
  it("rejects browser-executable uploads and oversized/empty files", () => {
    expect(() =>
      validateUpload({ name: "script.svg", size: 100, type: "image/svg+xml" }),
    ).toThrow("not supported");
    expect(() =>
      validateUpload({
        name: "big.pdf",
        size: MAX_UPLOAD_BYTES + 1,
        type: "application/pdf",
      }),
    ).toThrow("10 MB");
    expect(() =>
      validateUpload({ name: "empty.txt", size: 0, type: "text/plain" }),
    ).toThrow();
  });
  it("sanitizes path separators and control characters in attachment names", () => {
    expect(
      validateUpload({
        name: "../../bad\u0000.txt",
        size: 20,
        type: "text/plain",
      }).name,
    ).toBe(".._.._bad_.txt");
  });
  it("rejects scheduling in the past", () => {
    expect(
      scheduleInput.safeParse({
        id,
        conversationId: id,
        body: "hi",
        scheduledAt: "2020-01-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });
  it("updates quiet hours without resetting unrelated profile fields", () => {
    expect(
      profilePatch.parse({ dnd_until: "2026-10-28T12:00:00.000Z" }),
    ).toEqual({ dnd_until: "2026-10-28T12:00:00.000Z" });
    expect(profilePatch.parse({ status: "Focus time" })).toEqual({
      status: "Focus time",
    });
  });
  it("allows clearing a photo and rejects non-http image URLs", () => {
    expect(profilePatch.parse({ avatar_url: null })).toEqual({
      avatar_url: null,
    });
    expect(
      profilePatch.safeParse({ avatar_url: "javascript:alert(1)" }).success,
    ).toBe(false);
  });
});

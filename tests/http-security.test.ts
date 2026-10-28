import { describe, expect, it } from "vitest";
import { assertSameOrigin, readJson } from "../src/lib/http-security";

describe("cookie endpoint CSRF and request limits", () => {
  it("denies cross-origin authenticated mutation attempts and opaque origins", () => {
    for (const origin of [
      "https://attacker.test",
      "null",
      "https://relay.test.attacker.test",
    ]) {
      expect(() =>
        assertSameOrigin(
          new Request("https://relay.test/api/messages", {
            method: "POST",
            headers: { origin },
          }),
        ),
      ).toThrow("must come from");
    }
  });
  it("denies missing-origin mutation attempts", () => {
    expect(() =>
      assertSameOrigin(
        new Request("https://relay.test/api/messages", { method: "POST" }),
      ),
    ).toThrow();
  });
  it("accepts the exact application origin", () => {
    expect(() =>
      assertSameOrigin(
        new Request("https://relay.test/api/messages", {
          method: "POST",
          headers: { origin: "https://relay.test" },
        }),
      ),
    ).not.toThrow();
  });
  it("rejects simple-form CSRF bodies before parsing", async () => {
    await expect(
      readJson(
        new Request("https://relay.test/api/messages", {
          method: "POST",
          body: "body=hello",
        }),
      ),
    ).rejects.toMatchObject({ status: 415 });
  });
  it("caps actual bytes even if Content-Length is missing or understated", async () => {
    const request = new Request("https://relay.test/api/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "1" },
      body: JSON.stringify({ body: "x".repeat(100) }),
    });
    await expect(readJson(request, 50)).rejects.toMatchObject({ status: 413 });
  });
  it("rejects malformed JSON with a client error", async () => {
    await expect(
      readJson(
        new Request("https://relay.test/api/messages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{",
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("parses bounded JSON for the Zod business validators", async () => {
    await expect(
      readJson(
        new Request("https://relay.test/api/messages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"body":"hi"}',
        }),
      ),
    ).resolves.toEqual({ body: "hi" });
  });
});

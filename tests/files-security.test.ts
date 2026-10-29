import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFiles } from "../src/lib/relay/files";

const userId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const messageId = "33333333-3333-4333-8333-333333333333";
function fixture({
  signedIn = true,
  uploadDenied = false,
  metadataDenied = false,
  signingDenied = false,
} = {}) {
  const upload = vi.fn(
    async (_path: string, _file: File, _options: Record<string, unknown>) => ({
      error: uploadDenied ? { message: "Upload denied" } : null,
    }),
  );
  const remove = vi.fn(async () => ({ error: null }));
  const createSignedUrl = vi.fn(async () => ({
    error: signingDenied ? { message: "Access denied" } : null,
    data: signingDenied
      ? null
      : {
          signedUrl:
            "https://example.supabase.co/storage/v1/object/sign/attachments/file?token=test",
        },
  }));
  const bucket = vi.fn(() => ({ upload, remove, createSignedUrl }));
  const insert = vi.fn(() => ({
    select: () => ({
      single: async () => ({
        error: metadataDenied ? { message: "Metadata denied" } : null,
        data: { id: messageId },
      }),
    }),
  }));
  const client = {
    auth: {
      getUser: async () => ({
        error: null,
        data: { user: signedIn ? { id: userId } : null },
      }),
    },
    storage: { from: bucket },
    from: () => ({ insert }),
  } as unknown as SupabaseClient;
  return {
    service: createFiles(() => client),
    upload,
    remove,
    createSignedUrl,
    bucket,
    insert,
  };
}
const document = () =>
  new File(["%PDF-test"], "report.pdf", { type: "application/pdf" });

describe("private attachment transfer boundaries", () => {
  it("requires a verified user before transferring bytes", async () => {
    const f = fixture({ signedIn: false });
    await expect(
      f.service.uploadAttachment(document(), conversationId, messageId),
    ).rejects.toThrow(/Sign in/);
    expect(f.bucket).not.toHaveBeenCalled();
  });
  it("rejects forged identifiers before any storage request", async () => {
    const f = fixture();
    await expect(
      f.service.uploadAttachment(document(), "../another-tenant", messageId),
    ).rejects.toThrow();
    expect(f.bucket).not.toHaveBeenCalled();
  });
  it("uses the private bucket and verified owner path without a long-lived browser cache", async () => {
    const f = fixture();
    await f.service.uploadAttachment(document(), conversationId, messageId);
    expect(f.bucket).toHaveBeenCalledWith("attachments");
    expect(f.upload).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(
          "^" + conversationId + "/" + userId + "/[0-9a-f-]+/report.pdf$",
        ),
      ),
      expect.any(File),
      { upsert: false, contentType: "application/pdf", cacheControl: "0" },
    );
    expect(f.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        uploaded_by: userId,
        conversation_id: conversationId,
        message_id: messageId,
      }),
    );
  });
  it("does not publish attachment metadata when Storage denies the upload", async () => {
    const f = fixture({ uploadDenied: true });
    await expect(
      f.service.uploadAttachment(document(), conversationId, messageId),
    ).rejects.toThrow("Upload denied");
    expect(f.insert).not.toHaveBeenCalled();
  });
  it("removes only its new upload if metadata publication is denied", async () => {
    const f = fixture({ metadataDenied: true });
    await expect(
      f.service.uploadAttachment(document(), conversationId, messageId),
    ).rejects.toThrow("Metadata denied");
    expect(f.remove).toHaveBeenCalledWith([f.upload.mock.calls[0][0]]);
  });
  it("issues 60-second download URLs and propagates signing authorization denial", async () => {
    const f = fixture();
    await f.service.signedAttachmentUrl({ path: "owned/file.pdf" }, true);
    expect(f.createSignedUrl).toHaveBeenCalledWith("owned/file.pdf", 60, {
      download: true,
    });
    await expect(
      fixture({ signingDenied: true }).service.signedAttachmentUrl({
        path: "foreign/file.pdf",
      }),
    ).rejects.toThrow("Access denied");
  });
});

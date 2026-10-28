import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { avatarMediaPath, canCleanupProfileMedia, createProfileMedia, MAX_PROFILE_IMAGE_BYTES, parseProfileMediaPath, profileImageMetadata, validateProfileImage, validateSignedProfileMediaUrl, workspaceMediaPath } from "../src/lib/profile-media";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const W = "33333333-3333-4333-8333-333333333333";
const OBJECT = "44444444-4444-4444-8444-444444444444";
const OTHER = "55555555-5555-4555-8555-555555555555";
const API = "https://relay-test.supabase.co";

function png(width = 1, height = 1) {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer); view.setUint32(16, width); view.setUint32(20, height);
  return new File([bytes], "chosen.png", { type: "image/png" });
}
function jpeg(width = 100, height = 50) {
  // Minimal SOF boundary fixture; browser decoding is a separate browser check.
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 8, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 0xff, 0xd9])], "chosen.jpg", { type: "image/jpeg" });
}
function webp(kind: "VP8X" | "VP8L" | "VP8 ", width = 32, height = 24) {
  const bytes = new Uint8Array(32);
  bytes.set([82, 73, 70, 70, 24, 0, 0, 0, 87, 69, 66, 80]);
  bytes.set([...kind].map(char => char.charCodeAt(0)), 12);
  const view = new DataView(bytes.buffer);
  if (kind === "VP8X") { bytes[24] = (width - 1) & 255; bytes[25] = (width - 1) >> 8; bytes[27] = (height - 1) & 255; bytes[28] = (height - 1) >> 8; }
  if (kind === "VP8L") { bytes[20] = 0x2f; bytes[21] = (width - 1) & 255; bytes[22] = ((width - 1) >> 8) | (((height - 1) & 3) << 6); bytes[23] = ((height - 1) >> 2) & 255; bytes[24] = (height - 1) >> 10; }
  if (kind === "VP8 ") { bytes.set([0x9d, 1, 0x2a], 23); view.setUint16(26, width, true); view.setUint16(28, height, true); }
  return new File([bytes], "chosen.webp", { type: "image/webp" });
}

describe("profile and workspace media boundaries", () => {
  it("generates UUID-only paths without retaining user filenames", () => {
    expect(avatarMediaPath(A, OBJECT, "png")).toBe(`avatars/${A}/${OBJECT}.png`);
    expect(workspaceMediaPath(W, A, OBJECT, "webp")).toBe(`workspaces/${W}/${A}/${OBJECT}.webp`);
    expect(() => avatarMediaPath("../other-user", OBJECT, "png")).toThrow();
    expect(() => workspaceMediaPath("https://evil.test", A, OBJECT, "png")).toThrow();
    expect(() => avatarMediaPath(A, OBJECT, "svg" as "png")).toThrow();
  });
  it.each(["https://evil.test/avatar.png", "//evil.test/avatar.png", "blob:https://app.example/object", `avatars/${A}/../${OBJECT}.png`, `avatars/${A}/${OBJECT}.svg`, `avatars/${A}/${OBJECT}.png?token=secret`, `workspaces/${W}/${A}/${OBJECT}.png/extra`])("rejects URL/path smuggling: %s", value => {
    expect(parseProfileMediaPath(value)).toBeNull();
  });
  it("cleans up only the current uploader's previous image in the intended scope", () => {
    expect(canCleanupProfileMedia(avatarMediaPath(A, OBJECT, "png"), A, { kind: "avatar" })).toBe(true);
    expect(canCleanupProfileMedia(avatarMediaPath(B, OBJECT, "png"), A, { kind: "avatar" })).toBe(false);
    expect(canCleanupProfileMedia(workspaceMediaPath(W, A, OBJECT, "png"), A, { kind: "workspace", workspaceId: W })).toBe(true);
    expect(canCleanupProfileMedia(workspaceMediaPath(W, B, OBJECT, "png"), A, { kind: "workspace", workspaceId: W })).toBe(false);
    expect(canCleanupProfileMedia(workspaceMediaPath(OTHER, A, OBJECT, "png"), A, { kind: "workspace", workspaceId: W })).toBe(false);
    expect(canCleanupProfileMedia(avatarMediaPath(A, OBJECT, "png"), A, { kind: "workspace", workspaceId: W })).toBe(false);
    expect(canCleanupProfileMedia("https://other-user.example/photo.png", A, { kind: "avatar" })).toBe(false);
  });
  it.each(["image/svg+xml", "image/gif", "text/html", "toString", "__proto__", ""])('rejects unsupported or inherited MIME "%s"', type => {
    expect(() => profileImageMetadata({ size: 64, type })).toThrow();
  });
  it.each([0, -1, NaN, Infinity, MAX_PROFILE_IMAGE_BYTES + 1, 1.5])("rejects invalid size %s", size => {
    expect(() => profileImageMetadata({ size, type: "image/png" })).toThrow();
  });
  it("accepts the size boundary and derives its extension from MIME, not filename", () => {
    expect(profileImageMetadata({ size: MAX_PROFILE_IMAGE_BYTES, type: "image/jpeg" }).extension).toBe("jpg");
  });
  it("rejects HTML/SVG content carrying an allowed image MIME before upload", async () => {
    await expect(validateProfileImage(new File(["<svg onload='alert(1)'/>"], "avatar.png", { type: "image/png" }))).rejects.toThrow(/format/);
    await expect(validateProfileImage(new File(["<script>alert(1)</script>"], "avatar.jpg", { type: "image/jpeg" }))).rejects.toThrow(/format/);
  });
  it("reads PNG/JPEG and all supported WebP dimension headers before bitmap allocation", async () => {
    expect(await validateProfileImage(png(100, 50))).toMatchObject({ width: 100, height: 50, extension: "png" });
    expect(await validateProfileImage(jpeg(100, 50))).toMatchObject({ width: 100, height: 50, extension: "jpg" });
    for (const kind of ["VP8X", "VP8L", "VP8 "] as const) expect(await validateProfileImage(webp(kind, 100, 50))).toMatchObject({ width: 100, height: 50, extension: "webp" });
  });
  it("bounds compressed-image dimensions before decoding and rejects invalid frame headers", async () => {
    await expect(validateProfileImage(png(100000, 100000))).rejects.toThrow(/4096/);
    await expect(validateProfileImage(jpeg(9000, 9000))).rejects.toThrow(/4096/);
    await expect(validateProfileImage(webp("VP8X", 5000, 5000))).rejects.toThrow(/4096/);
    await expect(validateProfileImage(png(0, 0))).rejects.toThrow(/header/);
    await expect(validateProfileImage(new File([new Uint8Array([255, 216, 255, 192, 255, 255])], "bad.jpg", { type: "image/jpeg" }))).rejects.toThrow(/header/);
  });
  it("accepts only the configured Storage origin and signed profile-media route", () => {
    const good = `${API}/storage/v1/object/sign/profile-media/avatars/${A}/${OBJECT}.png?token=test`;
    expect(validateSignedProfileMediaUrl(good, API)).toBe(good);
    for (const value of ["https://evil.test/image.png", "blob:https://relay-test.supabase.co/opaque", `${API}/storage/v1/object/public/profile-media/photo.png`, `${API}/storage/v1/object/sign/attachments/file.png`, `https://user:password@relay-test.supabase.co/storage/v1/object/sign/profile-media/a.png`]) expect(() => validateSignedProfileMediaUrl(value, API)).toThrow();
  });
});

function fakeClient({ oldPath = null as string | null, rpcError = null as { message: string } | null, cleanupError = false, uid = A } = {}) {
  const remove = vi.fn(async (_paths: string[]) => ({ error: cleanupError ? { message: "Deletion denied" } : null }));
  const upload = vi.fn(async () => ({ data: {}, error: null }));
  const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => ({ data: rpcError ? null : { id: uid, avatar_path: args.p_path }, error: rpcError }));
  const query = { select: () => query, eq: () => query, single: async () => ({ data: { avatar_path: oldPath, logo_path: oldPath }, error: null }) };
  const client = { auth: { getUser: async () => ({ data: { user: { id: uid } }, error: null }) }, from: () => query, storage: { from: () => ({ upload, remove }) }, rpc } as unknown as SupabaseClient;
  return { client, remove, upload, rpc };
}
describe("media service sequencing (isolated client contract tests, not hosted Storage)", () => {
  it("publishes the new path before removing a previous own avatar", async () => {
    const old = avatarMediaPath(A, OTHER, "png"); const fx = fakeClient({ oldPath: old });
    const result = await createProfileMedia(fx.client).uploadAvatar(png());
    expect(fx.rpc).toHaveBeenCalledWith("set_avatar", expect.objectContaining({ p_path: expect.stringMatching(new RegExp(`^avatars/${A}/`)) }));
    expect(fx.remove).toHaveBeenCalledWith([old]);
    expect(fx.remove.mock.invocationCallOrder[0]).toBeGreaterThan(fx.rpc.mock.invocationCallOrder[0]);
    expect(result.warning).toBeUndefined();
  });
  it("never removes another user's logo while replacing a workspace image", async () => {
    const fx = fakeClient({ oldPath: workspaceMediaPath(W, B, OTHER, "png") });
    await createProfileMedia(fx.client).uploadWorkspaceLogo(W, png());
    expect(fx.rpc).toHaveBeenCalledWith("set_workspace_logo", expect.objectContaining({ p_workspace_id: W }));
    expect(fx.remove).not.toHaveBeenCalled();
  });
  it("rolls back only the newly uploaded object when publication is rejected", async () => {
    const old = avatarMediaPath(A, OTHER, "png"); const fx = fakeClient({ oldPath: old, rpcError: { message: "Permission denied" } });
    await expect(createProfileMedia(fx.client).uploadAvatar(png())).rejects.toThrow("Permission denied");
    expect(fx.remove).toHaveBeenCalledTimes(1);
    const removed = fx.remove.mock.calls[0][0][0];
    expect(removed).not.toBe(old); expect(canCleanupProfileMedia(removed, A, { kind: "avatar" })).toBe(true);
  });
  it("reports cleanup failure without pretending the successfully saved image failed", async () => {
    const fx = fakeClient({ oldPath: avatarMediaPath(A, OTHER, "png"), cleanupError: true });
    const result = await createProfileMedia(fx.client).uploadAvatar(png());
    expect(result.value.avatar_path).toMatch(new RegExp(`^avatars/${A}/`));
    expect(result.warning).toMatch(/saved.*could not be removed/);
  });
  it("does not attempt any transfer for spoofed content or an invalid workspace ID", async () => {
    const fx = fakeClient();
    await expect(createProfileMedia(fx.client).uploadAvatar(new File(["<svg/>"], "photo.png", { type: "image/png" }))).rejects.toThrow();
    await expect(createProfileMedia(fx.client).uploadWorkspaceLogo("../private", png())).rejects.toThrow();
    expect(fx.upload).not.toHaveBeenCalled(); expect(fx.rpc).not.toHaveBeenCalled(); expect(fx.remove).not.toHaveBeenCalled();
  });
  it("refuses to mutate the signed-in account when settings still belong to a previous account", async () => {
    const fx = fakeClient({ uid: B });
    await expect(createProfileMedia(fx.client).uploadAvatar(png(), A)).rejects.toThrow(/account changed/);
    await expect(createProfileMedia(fx.client).removeAvatar(A)).rejects.toThrow(/account changed/);
    expect(fx.upload).not.toHaveBeenCalled(); expect(fx.rpc).not.toHaveBeenCalled(); expect(fx.remove).not.toHaveBeenCalled();
  });
});

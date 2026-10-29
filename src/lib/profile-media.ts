import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile, Workspace } from "@/lib/types";
import { getBrowserClient } from "@/lib/supabase/browser";
import { publicEnv } from "@/lib/env";

export const PROFILE_MEDIA_BUCKET = "profile-media";
export const MAX_PROFILE_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_PROFILE_IMAGE_DIMENSION = 4096;
export const PROFILE_IMAGE_URL_SECONDS = 60;
export const PROFILE_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
const ID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const UUID = new RegExp(`^${ID}$`, "i");
const AVATAR = new RegExp(`^avatars/(${ID})/(${ID})\\.(jpg|png|webp)$`, "i");
const LOGO = new RegExp(`^workspaces/(${ID})/(${ID})/(${ID})\\.(jpg|png|webp)$`, "i");
const EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
export type ProfileImageMime = keyof typeof EXTENSIONS;
export type ProfileImageExtension = (typeof EXTENSIONS)[ProfileImageMime];
export type ProfileMediaPath =
  | { kind: "avatar"; userId: string; objectId: string; extension: ProfileImageExtension }
  | { kind: "workspace"; workspaceId: string; userId: string; objectId: string; extension: ProfileImageExtension };
export interface MediaSaveResult<T> { value: T; warning?: string }
export interface SignedProfileMedia { url: string; expiresAt: number }

function validId(value: string) {
  if (!UUID.test(value)) throw new Error("The image destination is invalid.");
  return value.toLowerCase();
}

/** Object names are generated locally; the user's filename is never a path. */
export function avatarMediaPath(userId: string, objectId: string, extension: ProfileImageExtension) {
  if (!["jpg", "png", "webp"].includes(extension)) throw new Error("Unsupported image format.");
  return `avatars/${validId(userId)}/${validId(objectId)}.${extension}`;
}
export function workspaceMediaPath(workspaceId: string, userId: string, objectId: string, extension: ProfileImageExtension) {
  if (!["jpg", "png", "webp"].includes(extension)) throw new Error("Unsupported image format.");
  return `workspaces/${validId(workspaceId)}/${validId(userId)}/${validId(objectId)}.${extension}`;
}
export function parseProfileMediaPath(path: string): ProfileMediaPath | null {
  const avatar = AVATAR.exec(path);
  if (avatar) return { kind: "avatar", userId: avatar[1].toLowerCase(), objectId: avatar[2].toLowerCase(), extension: avatar[3].toLowerCase() as ProfileImageExtension };
  const logo = LOGO.exec(path);
  return logo ? { kind: "workspace", workspaceId: logo[1].toLowerCase(), userId: logo[2].toLowerCase(), objectId: logo[3].toLowerCase(), extension: logo[4].toLowerCase() as ProfileImageExtension } : null;
}

/** A convenience guard only. Storage RLS independently denies unsafe deletion. */
export function canCleanupProfileMedia(path: string | null | undefined, userId: string, target: { kind: "avatar" } | { kind: "workspace"; workspaceId: string }): path is string {
  if (!path || !UUID.test(userId)) return false;
  const parsed = parseProfileMediaPath(path);
  return Boolean(parsed && parsed.userId === userId.toLowerCase() && parsed.kind === target.kind && (parsed.kind !== "workspace" || target.kind === "workspace" && parsed.workspaceId === target.workspaceId.toLowerCase()));
}

export function profileImageMetadata(file: Pick<File, "size" | "type">) {
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_PROFILE_IMAGE_BYTES) throw new Error("Choose an image no larger than 2 MiB.");
  if (!Object.hasOwn(EXTENSIONS, file.type)) throw new Error("Choose a JPEG, PNG, or WebP image. SVG and animated GIF files are not supported.");
  const mime = file.type as ProfileImageMime;
  return { mime, extension: EXTENSIONS[mime], size: file.size };
}

/** Detect obvious MIME spoofing before decoding or transferring the local file. */
export async function validateProfileImage(file: Pick<File, "size" | "type" | "slice">) {
  const metadata = profileImageMetadata(file);
  const bytes = new Uint8Array(await file.slice(0, metadata.mime === "image/jpeg" ? file.size : 32).arrayBuffer());
  const equals = (at: number, sequence: number[]) => sequence.every((value, index) => bytes[at + index] === value);
  const png = bytes.length >= 24 && equals(0, [137, 80, 78, 71, 13, 10, 26, 10]) && equals(12, [73, 72, 68, 82]);
  const jpeg = bytes.length >= 3 && equals(0, [255, 216, 255]);
  const webp = bytes.length >= 16 && equals(0, [82, 73, 70, 70]) && equals(8, [87, 69, 66, 80]) && (equals(12, [86, 80, 56, 32]) || equals(12, [86, 80, 56, 76]) || equals(12, [86, 80, 56, 88]));
  if (!(metadata.mime === "image/png" && png || metadata.mime === "image/jpeg" && jpeg || metadata.mime === "image/webp" && webp)) throw new Error("This file does not match its image format. Choose a valid JPEG, PNG, or WebP image.");
  const dimensions = rasterDimensions(bytes, metadata.mime);
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) throw new Error("This image has an invalid image header. Choose another image.");
  if (dimensions.width > MAX_PROFILE_IMAGE_DIMENSION || dimensions.height > MAX_PROFILE_IMAGE_DIMENSION) throw new Error("Choose an image no larger than 4096 × 4096 pixels.");
  return { ...metadata, ...dimensions };
}

/** Read dimensions before allocating decoded pixels, including compressed images. */
function rasterDimensions(bytes: Uint8Array, mime: ProfileImageMime): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === "image/png") return bytes.length >= 24 ? { width: view.getUint32(16), height: view.getUint32(20) } : null;
  if (mime === "image/webp") {
    const kind = String.fromCharCode(...bytes.slice(12, 16));
    if (kind === "VP8X" && bytes.length >= 30) return { width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) };
    if (kind === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) return { width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8), height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0xf) << 10) };
    if (kind === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    return null;
  }
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda || marker === undefined) return null;
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.length) return null;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return length >= 8 ? { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) } : null;
    offset += length;
  }
  return null;
}

/** Decode only a local File and re-encode pixels, omitting the original metadata. */
export async function prepareProfileImage(file: File): Promise<File> {
  const metadata = await validateProfileImage(file);
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") throw new Error("This browser cannot prepare images. Try a current version of Edge, Chrome, Firefox, or Safari.");
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error("This image could not be decoded. Choose another JPEG, PNG, or WebP file."); }
  try {
    if (bitmap.width < 1 || bitmap.height < 1 || bitmap.width > MAX_PROFILE_IMAGE_DIMENSION || bitmap.height > MAX_PROFILE_IMAGE_DIMENSION) throw new Error("Choose an image no larger than 4096 × 4096 pixels.");
    const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The image could not be prepared. Try another browser.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, metadata.mime, 0.9));
    if (!blob || blob.type !== metadata.mime) throw new Error("This browser cannot save that image format. Try a JPEG or PNG.");
    const prepared = new File([blob], `image.${metadata.extension}`, { type: metadata.mime });
    await validateProfileImage(prepared);
    return prepared;
  } finally { bitmap.close(); }
}

function message(error: unknown, fallback: string) {
  return error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : fallback;
}
function check(error: unknown, fallback: string): asserts error is null | undefined {
  if (error) throw new Error(message(error, fallback));
}

export function validateSignedProfileMediaUrl(raw: string, storageOrigin: string) {
  const base = new URL(storageOrigin);
  const url = new URL(raw);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.origin !== base.origin || (url.protocol !== "https:" && !(url.protocol === "http:" && local)) || url.username || url.password || !url.pathname.startsWith("/storage/v1/object/sign/profile-media/")) throw new Error("The image service returned an invalid image address.");
  return url.href;
}

export function createProfileMedia(client: SupabaseClient, { storageOrigin = publicEnv().supabaseUrl }: { storageOrigin?: string } = {}) {
  const storage = () => client.storage.from(PROFILE_MEDIA_BUCKET);
  async function actor() {
    const { data, error } = await client.auth.getUser();
    check(error, "Your session could not be verified.");
    if (!data.user) throw new Error("Sign in before changing an image.");
    return validId(data.user.id);
  }
  async function cleanup(path: string | null | undefined, userId: string, target: Parameters<typeof canCleanupProfileMedia>[2]) {
    if (!canCleanupProfileMedia(path, userId, target)) return undefined;
    const warning = "The image was saved, but the previous upload could not be removed. Contact your workspace administrator if this continues.";
    try { const { error } = await storage().remove([path]); return error ? warning : undefined; } catch { return warning; }
  }
  async function publish<T>(file: File, path: string, rpcName: string, args: Record<string, unknown>) {
    const metadata = await validateProfileImage(file);
    const uploaded = await storage().upload(path, file, { upsert: false, contentType: metadata.mime, cacheControl: "0" });
    check(uploaded.error, "The image could not be uploaded.");
    const saved = await client.rpc(rpcName, args);
    if (saved.error || !saved.data) {
      let rollbackFailed = false;
      try { const rollback = await storage().remove([path]); rollbackFailed = Boolean(rollback.error); } catch { rollbackFailed = true; }
      const detail = rollbackFailed ? " The unused upload could not be removed; please contact support." : "";
      throw new Error(`${message(saved.error, "The image could not be saved.")}${detail}`);
    }
    return saved.data as T;
  }
  return {
    async uploadAvatar(file: File, expectedUserId?: string): Promise<MediaSaveResult<Profile>> {
      const metadata = await validateProfileImage(file);
      const userId = await actor();
      if (expectedUserId && validId(expectedUserId) !== userId) throw new Error("Your account changed. Reopen profile settings before updating the photo.");
      const previous = await client.from("profiles").select("avatar_path").eq("id", userId).single();
      check(previous.error, "Your current profile could not be loaded.");
      const path = avatarMediaPath(userId, crypto.randomUUID(), metadata.extension);
      const value = await publish<Profile>(file, path, "set_avatar", { p_path: path });
      const warning = await cleanup(previous.data?.avatar_path, userId, { kind: "avatar" });
      return { value, warning };
    },
    async removeAvatar(expectedUserId?: string): Promise<MediaSaveResult<Profile>> {
      const userId = await actor();
      if (expectedUserId && validId(expectedUserId) !== userId) throw new Error("Your account changed. Reopen profile settings before removing the photo.");
      const previous = await client.from("profiles").select("avatar_path").eq("id", userId).single();
      check(previous.error, "Your current profile could not be loaded.");
      const saved = await client.rpc("set_avatar", { p_path: null });
      check(saved.error, "The photo could not be removed.");
      if (!saved.data) throw new Error("The photo could not be removed.");
      const warning = await cleanup(previous.data?.avatar_path, userId, { kind: "avatar" });
      return { value: saved.data as Profile, warning };
    },
    async uploadWorkspaceLogo(workspaceId: string, file: File): Promise<MediaSaveResult<Workspace>> {
      validId(workspaceId);
      const metadata = await validateProfileImage(file);
      const userId = await actor();
      const previous = await client.from("workspaces").select("logo_path").eq("id", workspaceId).single();
      check(previous.error, "The workspace could not be loaded.");
      const path = workspaceMediaPath(workspaceId, userId, crypto.randomUUID(), metadata.extension);
      const value = await publish<Workspace>(file, path, "set_workspace_logo", { p_workspace_id: workspaceId, p_path: path });
      const warning = await cleanup(previous.data?.logo_path, userId, { kind: "workspace", workspaceId });
      return { value, warning };
    },
    async removeWorkspaceLogo(workspaceId: string): Promise<MediaSaveResult<Workspace>> {
      validId(workspaceId);
      const userId = await actor();
      const previous = await client.from("workspaces").select("logo_path").eq("id", workspaceId).single();
      check(previous.error, "The workspace could not be loaded.");
      const saved = await client.rpc("set_workspace_logo", { p_workspace_id: workspaceId, p_path: null });
      check(saved.error, "The workspace logo could not be removed.");
      if (!saved.data) throw new Error("The workspace logo could not be removed.");
      const warning = await cleanup(previous.data?.logo_path, userId, { kind: "workspace", workspaceId });
      return { value: saved.data as Workspace, warning };
    },
    async signedUrl(path: string): Promise<SignedProfileMedia> {
      if (!parseProfileMediaPath(path)) throw new Error("The stored image path is invalid.");
      const { data, error } = await storage().createSignedUrl(path, PROFILE_IMAGE_URL_SECONDS);
      check(error, "This image is unavailable or you no longer have access.");
      if (!data?.signedUrl) throw new Error("The image could not be loaded.");
      return { url: validateSignedProfileMediaUrl(data.signedUrl, storageOrigin), expiresAt: Date.now() + PROFILE_IMAGE_URL_SECONDS * 1000 };
    },
  };
}

type CacheEntry = { value?: SignedProfileMedia; pending?: Promise<SignedProfileMedia> };
const signedCache = new WeakMap<SupabaseClient, Map<string, CacheEntry>>();
export function clearProfileMediaCache(client: SupabaseClient) { signedCache.delete(client); }
export async function signedProfileMediaUrl(path: string, { client = getBrowserClient(), force = false }: { client?: SupabaseClient; force?: boolean } = {}) {
  if (!parseProfileMediaPath(path)) throw new Error("The stored image path is invalid.");
  let cache = signedCache.get(client);
  if (!cache) { cache = new Map(); signedCache.set(client, cache); }
  const prior = cache.get(path);
  if (prior?.pending) return prior.pending;
  if (!force && prior?.value && prior.value.expiresAt > Date.now() + 15000) return prior.value;
  const entry: CacheEntry = {};
  entry.pending = createProfileMedia(client).signedUrl(path).then(value => { entry.value = value; entry.pending = undefined; return value; }).catch(error => { cache?.delete(path); throw error; });
  cache.set(path, entry);
  // Bound the session-local cache independently of long conversation history.
  if (cache.size > 200) { for (const [key, value] of cache) { if (key !== path && !value.pending) { cache.delete(key); if (cache.size <= 150) break; } } }
  return entry.pending;
}

import { z } from "zod";

export const uuid = z.uuid();
export const messageBody = z
  .string()
  .trim()
  .min(1, "Write a message first.")
  .max(12000, "Messages can contain up to 12,000 characters.");
export const messageInput = z.object({
  id: uuid,
  conversationId: uuid,
  body: messageBody,
  parentId: uuid.nullish(),
});
export const workspaceInput = z.object({
  name: z.string().trim().min(2).max(80),
});
export const conversationInput = z.object({
  workspaceId: uuid,
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["public", "private", "dm"]),
  description: z.string().trim().max(500).default(""),
  memberIds: z.array(uuid).max(50).default([]),
});
export const profileInput = z.object({
  display_name: z.string().trim().min(1).max(80),
  username: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers, and underscores."),
  title: z.string().max(100).default(""),
  bio: z.string().max(1000).default(""),
  status: z.string().max(100).default(""),
  status_emoji: z.string().max(12).default(""),
  dnd_until: z.iso.datetime().nullable().default(null),
});
export const profilePatch = z
  .object({
    display_name: z.string().trim().min(1).max(80).optional(),
    username: z
      .string()
      .trim()
      .min(3)
      .max(40)
      .regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers, and underscores.")
      .optional(),
    avatar_url: z
      .url()
      .max(2048)
      .refine((value) => /^https?:\/\//.test(value), "Use an HTTPS image URL.")
      .nullable()
      .optional(),
    title: z.string().max(100).optional(),
    bio: z.string().max(1000).optional(),
    status: z.string().max(100).optional(),
    status_emoji: z.string().max(12).optional(),
    dnd_until: z.iso.datetime().nullable().optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "Choose a profile field to update.",
  );
export const searchInput = z.object({
  workspaceId: uuid,
  query: z.string().trim().min(1).max(200),
  conversationId: uuid.optional(),
  authorId: uuid.optional(),
  before: z.iso.datetime().optional(),
  limit: z.number().int().min(1).max(50).default(30),
  offset: z.number().int().min(0).max(10000).default(0),
});
export const scheduleInput = messageInput.extend({
  scheduledAt: z.iso
    .datetime()
    .refine(
      (v) => Date.parse(v) > Date.now() + 60_000,
      "Choose a time at least one minute from now.",
    ),
});
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ALLOWED_UPLOAD_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
export function validateUpload(file: Pick<File, "name" | "size" | "type">) {
  if (!file.size || file.size > MAX_UPLOAD_BYTES)
    throw new Error("Choose a file between 1 byte and 10 MB.");
  if (!ALLOWED_UPLOAD_TYPES.has(file.type))
    throw new Error(
      "This file type is not supported. Use an image, PDF, text file, Office document, or ZIP.",
    );
  return {
    name: file.name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 180),
    size: file.size,
    mime_type: file.type,
  };
}

/** Only local absolute paths, never scheme-relative or escaped URLs. */
export function safeRedirect(value: string | null, fallback = "/") {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u0020]/.test(value)
  )
    return fallback;
  return value;
}

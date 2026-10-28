import type { NextRequest } from "next/server";
import {
  api,
  assertSameOrigin,
  authenticatedClient,
  HttpError,
} from "@/lib/http";
import { createRelay } from "@/lib/relay/service";
import { MAX_UPLOAD_BYTES, uuid } from "@/lib/validation";
import { readBytes } from "@/lib/http-security";

export async function GET(request: NextRequest) {
  return api(async () => {
    const { client } = await authenticatedClient();
    const id = uuid.parse(request.nextUrl.searchParams.get("id"));
    const { data, error } = await client
      .from("attachments")
      .select("path")
      .eq("id", id)
      .maybeSingle();
    if (error || !data)
      throw new HttpError(404, "File not found or access denied.");
    return {
      url: await createRelay(() => client).signedAttachmentUrl(
        data,
        request.nextUrl.searchParams.get("download") === "1",
      ),
      expiresIn: 60,
    };
  });
}
export async function POST(request: NextRequest) {
  return api(async () => {
    assertSameOrigin(request);
    const { client } = await authenticatedClient();
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (!contentLength || contentLength > MAX_UPLOAD_BYTES + 8192)
      throw new HttpError(413, "Upload one file of at most 10 MB.");
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.startsWith("multipart/form-data;"))
      throw new HttpError(415, "Send this file as multipart form data.");
    const bytes = await readBytes(request, MAX_UPLOAD_BYTES + 8192);
    let form: FormData;
    try {
      form = await new Response(bytes, {
        headers: { "content-type": contentType },
      }).formData();
    } catch {
      throw new HttpError(400, "The upload form is invalid.");
    }
    const file = form.get("file");
    if (!(file instanceof File))
      throw new HttpError(400, "Select a file to upload.");
    const conversationId = uuid.parse(form.get("conversationId"));
    const messageId = uuid.parse(form.get("messageId"));
    return createRelay(() => client).uploadAttachment(
      file,
      conversationId,
      messageId,
    );
  });
}

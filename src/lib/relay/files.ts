import type { Attachment } from "@/lib/types";
import { uuid, validateUpload } from "@/lib/validation";
import { checkError, type ClientFactory } from "./shared";

export function createFiles(getClient: ClientFactory) {
  return {
    async uploadAttachment(
      file: File,
      conversationId: string,
      messageId: string,
    ): Promise<Attachment> {
      const metadata = validateUpload(file);
      uuid.parse(conversationId);
      uuid.parse(messageId);
      const client = getClient();
      const {
        data: { user },
        error: authError,
      } = await client.auth.getUser();
      checkError(authError);
      if (!user) throw new Error("Sign in to upload files.");
      const id = crypto.randomUUID();
      const path = `${conversationId}/${user.id}/${id}/${metadata.name}`;
      const { error: uploadError } = await client.storage
        .from("attachments")
        .upload(path, file, {
          upsert: false,
          contentType: file.type,
          cacheControl: "0",
        });
      checkError(uploadError);
      const { data, error } = await client
        .from("attachments")
        .insert({
          id,
          message_id: messageId,
          conversation_id: conversationId,
          uploaded_by: user.id,
          path,
          ...metadata,
        })
        .select("*")
        .single();
      if (error) {
        await client.storage.from("attachments").remove([path]);
        checkError(error);
      }
      return data as Attachment;
    },
    async signedAttachmentUrl(
      attachment: Pick<Attachment, "path">,
      download = false,
    ): Promise<string> {
      const { data, error } = await getClient()
        .storage.from("attachments")
        .createSignedUrl(attachment.path, 60, { download });
      checkError(error);
      if (!data?.signedUrl)
        throw new Error(
          "This file is unavailable or you no longer have access.",
        );
      return data.signedUrl;
    },
    async deleteAttachment(
      attachment: Pick<Attachment, "id" | "path">,
    ): Promise<void> {
      const client = getClient();
      const { error: objectError } = await client.storage
        .from("attachments")
        .remove([attachment.path]);
      checkError(objectError);
      const { error } = await client
        .from("attachments")
        .delete()
        .eq("id", uuid.parse(attachment.id));
      checkError(error);
    },
  };
}

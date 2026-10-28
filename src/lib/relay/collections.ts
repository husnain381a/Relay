import type {
  Attachment,
  Notification,
  SavedMessage,
  ScheduledMessage,
} from "../types";
import { uuid } from "../validation";
import {
  offsetPage,
  pageOptions,
  type OffsetPage,
  type PageOptions,
} from "../pagination";
import { checkError, MESSAGE_SELECT, type ClientFactory } from "./shared";

export function fileNamePattern(query: string) {
  const text = query.trim();
  if (text.length > 200)
    throw new Error("Search for a filename using at most 200 characters.");
  return `%${text.replace(/[\\%_]/g, "\\$&")}%`;
}

export function createCollectionQueries(getClient: ClientFactory) {
  return {
    async savedPage(
      workspaceId: string,
      options: PageOptions = {},
    ): Promise<OffsetPage<SavedMessage>> {
      const page = pageOptions(options);
      const { data, error } = await getClient()
        .from("saved_messages")
        .select(
          `*, message:messages!inner(${MESSAGE_SELECT}, conversation:conversations!inner(workspace_id))`,
        )
        .eq("message.conversation.workspace_id", uuid.parse(workspaceId))
        .order("created_at", { ascending: false })
        .order("message_id", { ascending: false })
        .range(page.offset, page.offset + page.limit);
      checkError(error);
      return offsetPage((data ?? []) as unknown as SavedMessage[], page);
    },
    async savedIds(workspaceId: string): Promise<string[]> {
      uuid.parse(workspaceId);
      const ids = new Set<string>();
      let cursor: string | undefined;
      // Keyset scan only identifiers. No silent PostgREST 1,000-row cap or message-body download.
      while (true) {
        let query = getClient()
          .from("saved_messages")
          .select(
            "message_id, message:messages!inner(conversation:conversations!inner(workspace_id))",
          )
          .eq("message.conversation.workspace_id", workspaceId)
          .order("message_id", { ascending: true })
          .limit(500);
        if (cursor) query = query.gt("message_id", cursor);
        const { data, error } = await query;
        checkError(error);
        const rows = (data ?? []) as unknown as { message_id: string }[];
        if (!rows.length) break;
        for (const row of rows) ids.add(row.message_id);
        const next = rows[rows.length - 1].message_id;
        if (next === cursor)
          throw new Error(
            "Saved-message pagination did not advance. Try refreshing.",
          );
        cursor = next;
        // Continue until empty rather than assuming a platform row limit is >=500.
      }
      return [...ids];
    },
    async notificationsPage(
      workspaceId: string,
      options: PageOptions = {},
    ): Promise<OffsetPage<Notification>> {
      const page = pageOptions(options);
      const { data, error } = await getClient()
        .from("notifications")
        .select("*")
        .eq("workspace_id", uuid.parse(workspaceId))
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(page.offset, page.offset + page.limit);
      checkError(error);
      return offsetPage((data ?? []) as Notification[], page);
    },
    async scheduledPage(
      workspaceId: string,
      options: PageOptions = {},
    ): Promise<OffsetPage<ScheduledMessage>> {
      const page = pageOptions(options);
      const { data, error } = await getClient()
        .from("scheduled_messages")
        .select("*, conversation:conversations!inner(workspace_id)")
        .eq("conversation.workspace_id", uuid.parse(workspaceId))
        .is("sent_at", null)
        .order("scheduled_at", { ascending: true })
        .order("id", { ascending: true })
        .range(page.offset, page.offset + page.limit);
      checkError(error);
      return offsetPage((data ?? []) as unknown as ScheduledMessage[], page);
    },
    async filesPage(
      workspaceId: string,
      query = "",
      options: PageOptions = {},
    ): Promise<OffsetPage<Attachment>> {
      const page = pageOptions(options);
      let request = getClient()
        .from("attachments")
        .select("*, conversation:conversations!inner(workspace_id)")
        .eq("conversation.workspace_id", uuid.parse(workspaceId));
      if (query.trim()) request = request.ilike("name", fileNamePattern(query));
      const { data, error } = await request
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(page.offset, page.offset + page.limit);
      checkError(error);
      return offsetPage((data ?? []) as unknown as Attachment[], page);
    },
  };
}

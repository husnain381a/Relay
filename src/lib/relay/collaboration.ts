import { z } from "zod";
import type {
  Draft,
  Message,
  ThreadSubscription,
  ThreadSummary,
} from "../types";
import {
  offsetPage,
  pageOptions,
  type OffsetPage,
  type PageOptions,
} from "../pagination";
import { uuid } from "../validation";
import { checkError, MESSAGE_SELECT, rpc, type ClientFactory } from "./shared";

export function createCollaboration(getClient: ClientFactory) {
  return {
    async threadSummaries(
      conversationId: string,
    ): Promise<Record<string, ThreadSummary>> {
      return (
        (await rpc<Record<string, ThreadSummary>>(
          getClient,
          "thread_summaries",
          { p_conversation_id: uuid.parse(conversationId) },
        )) ?? {}
      );
    },
    async threadSubscription(
      threadId: string,
    ): Promise<ThreadSubscription | null> {
      const client = getClient();
      const {
        data: { user },
        error: authError,
      } = await client.auth.getUser();
      checkError(authError);
      if (!user) return null;
      const { data, error } = await client
        .from("thread_subscriptions")
        .select("*")
        .eq("thread_id", uuid.parse(threadId))
        .eq("user_id", user.id)
        .maybeSingle();
      checkError(error);
      return data as ThreadSubscription | null;
    },
    async followThread(threadId: string, following: boolean): Promise<void> {
      return rpc(getClient, "follow_thread", {
        p_thread_id: uuid.parse(threadId),
        p_following: z.boolean().parse(following),
      });
    },
    async markThreadRead(threadId: string, seq: number): Promise<void> {
      return rpc(getClient, "mark_thread_read", {
        p_thread_id: uuid.parse(threadId),
        p_seq: z
          .number()
          .int()
          .nonnegative()
          .max(Number.MAX_SAFE_INTEGER)
          .parse(seq),
      });
    },
    async unreadThreadCounts(
      workspaceId: string,
    ): Promise<Record<string, number>> {
      return (
        (await rpc<Record<string, number>>(getClient, "unread_thread_counts", {
          p_workspace_id: uuid.parse(workspaceId),
        })) ?? {}
      );
    },
    async subscribedThreadsPage(
      workspaceId: string,
      options: PageOptions = {},
    ): Promise<OffsetPage<Message>> {
      const page = pageOptions(options);
      const { data, error } = await getClient()
        .rpc("subscribed_threads", {
          p_workspace_id: uuid.parse(workspaceId),
          p_limit: page.limit + 1,
          p_offset: page.offset,
        })
        .select(MESSAGE_SELECT);
      checkError(error);
      return offsetPage((data ?? []) as unknown as Message[], page);
    },
    async draft(
      conversationId: string,
      parentId?: string | null,
    ): Promise<Draft | null> {
      const client = getClient();
      const {
        data: { user },
        error: authError,
      } = await client.auth.getUser();
      checkError(authError);
      if (!user) return null;
      let query = client
        .from("message_drafts")
        .select("id,user_id,conversation_id,parent_id,body,updated_at")
        .eq("conversation_id", uuid.parse(conversationId))
        .eq("user_id", user.id);
      query = parentId
        ? query.eq("parent_id", uuid.parse(parentId))
        : query.is("parent_id", null);
      const { data, error } = await query.maybeSingle();
      checkError(error);
      return data as Draft | null;
    },
    async saveDraft(
      conversationId: string,
      body: string,
      parentId?: string | null,
    ): Promise<Draft | null> {
      return rpc(getClient, "save_draft", {
        p_conversation_id: uuid.parse(conversationId),
        p_body: z.string().max(12000).parse(body),
        p_parent_id: parentId ? uuid.parse(parentId) : null,
      });
    },
    async clearDraft(
      conversationId: string,
      parentId?: string | null,
    ): Promise<void> {
      return rpc(getClient, "clear_draft", {
        p_conversation_id: uuid.parse(conversationId),
        p_parent_id: parentId ? uuid.parse(parentId) : null,
      });
    },
  };
}

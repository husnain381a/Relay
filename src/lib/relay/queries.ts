import type {
  Attachment,
  AuditLog,
  Conversation,
  ConversationMember,
  Message,
  MessagePage,
  Notification,
  Pin,
  Profile,
  SavedMessage,
  ScheduledMessage,
  SearchFilters,
  SearchResult,
  Workspace,
  WorkspaceMember,
} from "../types";
import { searchInput, uuid } from "../validation";
import { checkError, MESSAGE_SELECT, rpc, type ClientFactory } from "./shared";
import { reconcileMessages } from "../messages";
import { fileNamePattern } from "./collections";
import {
  conversationDisplayName,
  type ConversationWithParticipants,
} from "../conversations";
const CONVERSATION_SELECT =
  "*, participants:conversation_members(user_id, profile:profiles!conversation_members_user_id_fkey(display_name))";

export function createQueries(getClient: ClientFactory) {
  return {
    async profile(id?: string): Promise<Profile | null> {
      const client = getClient();
      if (!id) {
        const { data, error } = await client.auth.getUser();
        checkError(error);
        id = data.user?.id;
      }
      if (!id) return null;
      const { data, error } = await client
        .from("profiles")
        .select("*")
        .eq("id", uuid.parse(id))
        .maybeSingle();
      checkError(error);
      return data as Profile | null;
    },
    async workspaces(): Promise<Workspace[]> {
      const { data, error } = await getClient()
        .from("workspaces")
        .select("*")
        .order("created_at");
      checkError(error);
      return (data ?? []) as Workspace[];
    },
    async members(workspaceId: string): Promise<WorkspaceMember[]> {
      const { data, error } = await getClient()
        .from("workspace_members")
        .select("*, profile:profiles!workspace_members_user_id_fkey(*)")
        .eq("workspace_id", uuid.parse(workspaceId))
        .order("joined_at");
      checkError(error);
      return (data ?? []) as unknown as WorkspaceMember[];
    },
    async conversations(workspaceId: string): Promise<Conversation[]> {
      const client = getClient();
      const {
        data: { user },
        error: authError,
      } = await client.auth.getUser();
      checkError(authError);
      if (!user) return [];
      const { data, error } = await client
        .from("conversations")
        .select(CONVERSATION_SELECT)
        .eq("workspace_id", uuid.parse(workspaceId))
        .order("created_at");
      checkError(error);
      return ((data ?? []) as unknown as ConversationWithParticipants[]).map(
        (row) => conversationDisplayName(row, user.id),
      );
    },
    async conversation(id: string): Promise<Conversation | null> {
      const client = getClient();
      const {
        data: { user },
        error: authError,
      } = await client.auth.getUser();
      checkError(authError);
      if (!user) return null;
      const { data, error } = await client
        .from("conversations")
        .select(CONVERSATION_SELECT)
        .eq("id", uuid.parse(id))
        .maybeSingle();
      checkError(error);
      return data
        ? conversationDisplayName(
            data as unknown as ConversationWithParticipants,
            user.id,
          )
        : null;
    },
    async conversationMembers(
      conversationId: string,
    ): Promise<ConversationMember[]> {
      const { data, error } = await getClient()
        .from("conversation_members")
        .select("*, profile:profiles!conversation_members_user_id_fkey(*)")
        .eq("conversation_id", uuid.parse(conversationId));
      checkError(error);
      return (data ?? []) as unknown as ConversationMember[];
    },
    async readStates(workspaceId: string): Promise<ConversationMember[]> {
      const {
        data: { user },
        error: authError,
      } = await getClient().auth.getUser();
      checkError(authError);
      if (!user) return [];
      const { data, error } = await getClient()
        .from("conversation_members")
        .select(
          "*, conversation:conversations!conversation_members_conversation_id_fkey!inner(workspace_id)",
        )
        .eq("user_id", user.id)
        .eq("conversation.workspace_id", uuid.parse(workspaceId));
      checkError(error);
      return (data ?? []) as unknown as ConversationMember[];
    },
    async messages(
      conversationId: string,
      options: {
        before?: number;
        parentId?: string | null;
        limit?: number;
      } = {},
    ): Promise<MessagePage> {
      const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
      let query = getClient()
        .from("messages")
        .select(MESSAGE_SELECT)
        .eq("conversation_id", uuid.parse(conversationId));
      query = options.parentId
        ? query.eq("parent_id", uuid.parse(options.parentId))
        : query.is("parent_id", null);
      if (options.before !== undefined) {
        if (!Number.isSafeInteger(options.before) || options.before < 1)
          throw new Error("Invalid pagination cursor.");
        query = query.lt("seq", options.before);
      }
      const { data, error } = await query
        .order("seq", { ascending: false })
        .limit(limit + 1);
      checkError(error);
      const rows = (data ?? []) as unknown as Message[];
      const hasMore = rows.length > limit;
      const messages = rows
        .slice(0, limit)
        .reverse()
        .map((row) => ({ ...row, delivery: "sent" as const }));
      return { messages, nextCursor: hasMore ? messages[0].seq : null };
    },
    async message(id: string): Promise<Message | null> {
      const { data, error } = await getClient()
        .from("messages")
        .select(MESSAGE_SELECT)
        .eq("id", uuid.parse(id))
        .maybeSingle();
      checkError(error);
      return data as unknown as Message | null;
    },
    async synchronizeMessages(
      conversationId: string,
      known: Message[],
      parentId?: string | null,
    ): Promise<Message[]> {
      uuid.parse(conversationId);
      const client = getClient();
      // A private-topic membership can be revoked while its socket remains joined.
      // Recheck the conversation before retaining any previously visible content.
      const { data: conversation, error: accessError } = await client
        .from("conversations")
        .select("id")
        .eq("id", conversationId)
        .maybeSingle();
      checkError(accessError);
      if (!conversation)
        throw new Error("You no longer have access to this conversation.");
      const local = known.filter(
        (m) =>
          m.conversation_id === conversationId &&
          m.parent_id === (parentId ?? null),
      );
      const pending = local.filter(
        (m) => m.delivery === "sending" || m.delivery === "failed",
      );
      const persisted = local.filter(
        (m) => m.delivery !== "sending" && m.delivery !== "failed",
      );
      const refreshed: Message[] = [];
      // Re-read the existing window as well as new messages, recovering offline edits,
      // reactions and soft deletions without assuming the last fifty events suffice.
      for (let i = 0; i < persisted.length; i += 100) {
        const { data, error } = await client
          .from("messages")
          .select(MESSAGE_SELECT)
          .eq("conversation_id", conversationId)
          .in(
            "id",
            persisted.slice(i, i + 100).map((m) => m.id),
          );
        checkError(error);
        refreshed.push(...((data ?? []) as unknown as Message[]));
      }
      let newestQuery = client
        .from("messages")
        .select("seq")
        .eq("conversation_id", conversationId);
      newestQuery = parentId
        ? newestQuery.eq("parent_id", parentId)
        : newestQuery.is("parent_id", null);
      const { data: newest, error: newestError } = await newestQuery
        .order("seq", { ascending: false })
        .limit(1);
      checkError(newestError);
      const highwater = newest?.[0]?.seq as number | undefined;
      if (highwater !== undefined) {
        if (!persisted.length) {
          let latestQuery = client
            .from("messages")
            .select(MESSAGE_SELECT)
            .eq("conversation_id", conversationId);
          latestQuery = parentId
            ? latestQuery.eq("parent_id", parentId)
            : latestQuery.is("parent_id", null);
          const { data, error } = await latestQuery
            .lte("seq", highwater)
            .order("seq", { ascending: false })
            .limit(50);
          checkError(error);
          refreshed.push(...((data ?? []) as unknown as Message[]));
        } else {
          let cursor = Math.max(...persisted.map((m) => m.seq));
          while (cursor < highwater) {
            let catchupQuery = client
              .from("messages")
              .select(MESSAGE_SELECT)
              .eq("conversation_id", conversationId);
            catchupQuery = parentId
              ? catchupQuery.eq("parent_id", parentId)
              : catchupQuery.is("parent_id", null);
            const { data, error } = await catchupQuery
              .gt("seq", cursor)
              .lte("seq", highwater)
              .order("seq", { ascending: true })
              .limit(100);
            checkError(error);
            const batch = (data ?? []) as unknown as Message[];
            if (!batch.length) break;
            refreshed.push(...batch);
            cursor = batch[batch.length - 1].seq;
          }
        }
      }
      return reconcileMessages(pending, refreshed);
    },
    async replyCounts(conversationId: string): Promise<Record<string, number>> {
      const result = await rpc<Record<string, number>>(
        getClient,
        "reply_counts",
        { p_conversation_id: uuid.parse(conversationId) },
      );
      return result ?? {};
    },
    async saved(workspaceId?: string): Promise<SavedMessage[]> {
      let query = getClient()
        .from("saved_messages")
        .select(
          `*, message:messages!saved_messages_message_id_fkey!inner(${MESSAGE_SELECT}, conversation:conversations!messages_conversation_id_fkey!inner(workspace_id))`,
        );
      if (workspaceId)
        query = query.eq(
          "message.conversation.workspace_id",
          uuid.parse(workspaceId),
        );
      const { data, error } = await query
        .order("created_at", { ascending: false })
        .limit(100);
      checkError(error);
      return (data ?? []) as unknown as SavedMessage[];
    },
    async pins(conversationId: string): Promise<Pin[]> {
      const { data, error } = await getClient()
        .from("pins")
        .select(`*, message:messages!pins_message_id_fkey(${MESSAGE_SELECT})`)
        .eq("conversation_id", uuid.parse(conversationId))
        .order("created_at", { ascending: false });
      checkError(error);
      return (data ?? []) as unknown as Pin[];
    },
    async notifications(workspaceId: string): Promise<Notification[]> {
      const { data, error } = await getClient()
        .from("notifications")
        .select("*")
        .eq("workspace_id", uuid.parse(workspaceId))
        .order("created_at", { ascending: false })
        .limit(100);
      checkError(error);
      return (data ?? []) as Notification[];
    },
    async unreadCounts(workspaceId: string): Promise<Record<string, number>> {
      return (
        (await rpc<Record<string, number>>(getClient, "unread_counts", {
          p_workspace_id: uuid.parse(workspaceId),
        })) ?? {}
      );
    },
    async scheduled(workspaceId?: string): Promise<ScheduledMessage[]> {
      let query = getClient()
        .from("scheduled_messages")
        .select(
          "*, conversation:conversations!scheduled_messages_conversation_id_fkey!inner(workspace_id)",
        )
        .is("sent_at", null);
      if (workspaceId)
        query = query.eq("conversation.workspace_id", uuid.parse(workspaceId));
      const { data, error } = await query.order("scheduled_at").limit(100);
      checkError(error);
      return (data ?? []) as unknown as ScheduledMessage[];
    },
    async search(
      workspaceId: string,
      query: string,
      filters: SearchFilters = {},
    ): Promise<SearchResult[]> {
      const input = searchInput.parse({ workspaceId, query, ...filters });
      const { data, error } = await getClient()
        .rpc("search_messages", {
          p_workspace_id: input.workspaceId,
          p_query: input.query,
          p_conversation_id: input.conversationId ?? null,
          p_author_id: input.authorId ?? null,
          p_before: input.before ?? null,
          p_limit: input.limit,
          p_offset: input.offset,
        })
        .select(MESSAGE_SELECT);
      checkError(error);
      return (data ?? []) as unknown as SearchResult[];
    },
    async files(workspaceId: string, query = ""): Promise<Attachment[]> {
      let request = getClient()
        .from("attachments")
        .select(
          "*, conversation:conversations!attachments_conversation_id_fkey!inner(workspace_id)",
        )
        .eq("conversation.workspace_id", uuid.parse(workspaceId));
      if (query) request = request.ilike("name", fileNamePattern(query));
      const { data, error } = await request
        .order("created_at", { ascending: false })
        .limit(50);
      checkError(error);
      return (data ?? []) as unknown as Attachment[];
    },
    async auditLogs(workspaceId: string): Promise<AuditLog[]> {
      const { data, error } = await getClient()
        .from("audit_logs")
        .select("*")
        .eq("workspace_id", uuid.parse(workspaceId))
        .order("created_at", { ascending: false })
        .limit(100);
      checkError(error);
      return (data ?? []) as AuditLog[];
    },
  };
}

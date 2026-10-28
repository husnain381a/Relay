import { z } from "zod";
import type {
  Conversation,
  Message,
  MessageInput,
  NotificationPreference,
  Profile,
  Role,
  ScheduledMessage,
  Workspace,
} from "@/lib/types";
import {
  conversationInput,
  messageBody,
  messageInput,
  profilePatch,
  scheduleInput,
  uuid,
  workspaceInput,
} from "@/lib/validation";
import { checkError, rpc, type ClientFactory } from "./shared";

export function createMutations(getClient: ClientFactory) {
  return {
    async createWorkspace(name: string): Promise<Workspace> {
      const input = workspaceInput.parse({ name });
      return rpc(getClient, "create_workspace", { p_name: input.name });
    },
    async createConversation(input: {
      workspaceId: string;
      name: string;
      kind: "public" | "private" | "dm";
      description?: string;
      memberIds?: string[];
    }): Promise<Conversation> {
      const value = conversationInput.parse(input);
      return rpc(getClient, "create_conversation", {
        p_workspace_id: value.workspaceId,
        p_name: value.name,
        p_kind: value.kind,
        p_description: value.description,
        p_member_ids: value.memberIds,
      });
    },
    async sendMessage(input: MessageInput): Promise<Message> {
      const value = messageInput.parse(input);
      const row = await rpc<
        Omit<Message, "author" | "reactions" | "attachments" | "delivery">
      >(getClient, "send_message", {
        p_id: value.id,
        p_conversation_id: value.conversationId,
        p_body: value.body,
        p_parent_id: value.parentId ?? null,
      });
      return {
        author: null,
        reactions: [],
        attachments: [],
        ...row,
        delivery: "sent",
      };
    },
    async editMessage(id: string, body: string): Promise<void> {
      return rpc(getClient, "edit_message", {
        p_id: uuid.parse(id),
        p_body: messageBody.parse(body),
      });
    },
    async deleteMessage(id: string): Promise<void> {
      return rpc(getClient, "delete_message", { p_id: uuid.parse(id) });
    },
    async toggleReaction(messageId: string, emoji: string): Promise<boolean> {
      return rpc(getClient, "toggle_reaction", {
        p_message_id: uuid.parse(messageId),
        p_emoji: z.string().min(1).max(16).parse(emoji),
      });
    },
    async toggleSaved(messageId: string): Promise<boolean> {
      return rpc(getClient, "toggle_saved", {
        p_message_id: uuid.parse(messageId),
      });
    },
    async pinMessage(messageId: string): Promise<boolean> {
      return rpc(getClient, "pin_message", {
        p_message_id: uuid.parse(messageId),
      });
    },
    async markRead(conversationId: string, seq: number): Promise<void> {
      return rpc(getClient, "mark_read", {
        p_conversation_id: uuid.parse(conversationId),
        p_seq: z.number().int().nonnegative().parse(seq),
      });
    },
    async createInvite(
      workspaceId: string,
    ): Promise<{ id: string; token: string; expires_at: string }> {
      return rpc(getClient, "create_invite", {
        p_workspace_id: uuid.parse(workspaceId),
      });
    },
    async acceptInvite(token: string): Promise<Workspace> {
      const id = await rpc<string>(getClient, "accept_invite", {
        p_token: z.string().min(20).max(256).parse(token),
      });
      const { data, error } = await getClient()
        .from("workspaces")
        .select("*")
        .eq("id", id)
        .single();
      checkError(error);
      return data as Workspace;
    },
    async updateWorkspace(id: string, name: string): Promise<void> {
      return rpc(getClient, "update_workspace", {
        p_id: uuid.parse(id),
        p_name: workspaceInput.parse({ name }).name,
      });
    },
    async updateConversation(
      id: string,
      input: {
        name: string;
        description: string;
        topic: string;
        archive?: boolean;
      },
    ): Promise<void> {
      return rpc(getClient, "update_conversation", {
        p_id: uuid.parse(id),
        p_name: z.string().trim().min(1).max(80).parse(input.name),
        p_description: z.string().max(500).parse(input.description),
        p_topic: z.string().max(250).parse(input.topic),
        p_archive: input.archive ?? false,
      });
    },
    async joinConversation(id: string): Promise<void> {
      return rpc(getClient, "join_conversation", { p_id: uuid.parse(id) });
    },
    async leaveConversation(id: string): Promise<void> {
      return rpc(getClient, "leave_conversation", { p_id: uuid.parse(id) });
    },
    async deleteConversation(id: string): Promise<void> {
      return rpc(getClient, "delete_conversation", { p_id: uuid.parse(id) });
    },
    async addConversationMember(
      conversationId: string,
      userId: string,
    ): Promise<void> {
      return rpc(getClient, "add_conversation_member", {
        p_conversation_id: uuid.parse(conversationId),
        p_user_id: uuid.parse(userId),
      });
    },
    async removeConversationMember(
      conversationId: string,
      userId: string,
    ): Promise<void> {
      return rpc(getClient, "remove_conversation_member", {
        p_conversation_id: uuid.parse(conversationId),
        p_user_id: uuid.parse(userId),
      });
    },
    async revokeInvite(id: string): Promise<void> {
      return rpc(getClient, "revoke_invite", { p_id: uuid.parse(id) });
    },
    async transferOwnership(
      workspaceId: string,
      userId: string,
    ): Promise<void> {
      return rpc(getClient, "transfer_ownership", {
        p_workspace_id: uuid.parse(workspaceId),
        p_user_id: uuid.parse(userId),
      });
    },
    async setMemberRole(
      workspaceId: string,
      userId: string,
      role: Role,
    ): Promise<void> {
      return rpc(getClient, "set_member_role", {
        p_workspace_id: uuid.parse(workspaceId),
        p_user_id: uuid.parse(userId),
        p_role: z.enum(["admin", "member"]).parse(role),
      });
    },
    async removeMember(workspaceId: string, userId: string): Promise<void> {
      return rpc(getClient, "remove_member", {
        p_workspace_id: uuid.parse(workspaceId),
        p_user_id: uuid.parse(userId),
      });
    },
    async setNotificationPreference(
      conversationId: string,
      preference: NotificationPreference,
    ): Promise<void> {
      return rpc(getClient, "set_notification_preference", {
        p_conversation_id: uuid.parse(conversationId),
        p_preference: z.enum(["all", "mentions", "mute"]).parse(preference),
      });
    },
    async scheduleMessage(
      input: MessageInput & { scheduledAt: string },
    ): Promise<ScheduledMessage> {
      const value = scheduleInput.parse(input);
      return rpc(getClient, "schedule_message", {
        p_id: value.id,
        p_conversation_id: value.conversationId,
        p_body: value.body,
        p_parent_id: value.parentId ?? null,
        p_scheduled_at: value.scheduledAt,
      });
    },
    async cancelScheduled(id: string): Promise<void> {
      const { error } = await getClient()
        .from("scheduled_messages")
        .delete()
        .eq("id", uuid.parse(id));
      checkError(error);
    },
    async updateProfile(input: Partial<Profile>): Promise<Profile> {
      const client = getClient();
      const {
        data: { user },
        error: authError,
      } = await client.auth.getUser();
      checkError(authError);
      if (!user) throw new Error("Sign in to update your profile.");
      const value = profilePatch.parse(input);
      const { data, error } = await client
        .from("profiles")
        .update(value)
        .eq("id", user.id)
        .select("*")
        .single();
      checkError(error);
      return data as Profile;
    },
    async markNotificationRead(id: string): Promise<void> {
      const { error } = await getClient()
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", uuid.parse(id));
      checkError(error);
    },
  };
}

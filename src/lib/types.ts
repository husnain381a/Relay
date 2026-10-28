export type UUID = string;
export type Role = "owner" | "admin" | "member";
export type ConversationKind = "public" | "private" | "dm";
export type NotificationPreference = "all" | "mentions" | "mute";

export interface Profile {
  avatar_path?: string | null;
  id: UUID;
  display_name: string;
  username: string;
  avatar_url: string | null;
  status: string;
  status_emoji: string;
  title: string;
  bio: string;
  dnd_until: string | null;
}
export interface Workspace {
  realtime_epoch?: UUID;
  logo_path?: string | null;
  id: UUID;
  name: string;
  slug: string;
  owner_id: UUID;
  created_at: string;
}
export interface ThreadSubscription {
  thread_id: UUID;
  user_id: UUID;
  last_read_seq: number;
  following: boolean;
  updated_at: string;
}
export interface ThreadSummary {
  reply_count: number;
  last_reply_seq: number | null;
  last_reply_at: string | null;
  unread_count: number;
  following: boolean;
  participants: Profile[];
}
export interface Draft {
  id: UUID;
  user_id: UUID;
  conversation_id: UUID;
  parent_id: UUID | null;
  body: string;
  updated_at: string;
}
export interface WorkspaceMember {
  workspace_id: UUID;
  user_id: UUID;
  role: Role;
  joined_at: string;
  profile: Profile;
}
export interface Conversation {
  realtime_epoch?: UUID;
  id: UUID;
  workspace_id: UUID;
  name: string;
  description: string;
  topic: string;
  kind: ConversationKind;
  created_by: UUID;
  archived_at: string | null;
  created_at: string;
}
export interface ConversationMember {
  conversation_id: UUID;
  user_id: UUID;
  last_read_seq: number;
  notification_preference: NotificationPreference;
  profile?: Profile;
}
export interface Reaction {
  message_id: UUID;
  user_id: UUID;
  emoji: string;
}
export interface Attachment {
  id: UUID;
  message_id: UUID;
  conversation_id: UUID;
  uploaded_by: UUID;
  path: string;
  name: string;
  mime_type: string;
  size: number;
  created_at: string;
}
export interface Message {
  id: UUID;
  conversation_id: UUID;
  author_id: UUID;
  body: string;
  parent_id: UUID | null;
  seq: number;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  author: Profile | null;
  reactions: Reaction[];
  attachments: Attachment[];
  delivery?: "sending" | "sent" | "failed";
  error?: string;
}
export interface MessageInput {
  id: UUID;
  conversationId: UUID;
  body: string;
  parentId?: UUID | null;
}
export interface MessagePage {
  messages: Message[];
  nextCursor: number | null;
}
export interface Notification {
  id: UUID;
  user_id: UUID;
  workspace_id: UUID;
  conversation_id: UUID;
  message_id: UUID;
  kind: string;
  read_at: string | null;
  created_at: string;
}
export interface SavedMessage {
  user_id: UUID;
  message_id: UUID;
  created_at: string;
  message: Message;
}
export interface Pin {
  conversation_id: UUID;
  message_id: UUID;
  pinned_by: UUID;
  created_at: string;
  message: Message;
}
export interface ScheduledMessage {
  id: UUID;
  conversation_id: UUID;
  author_id: UUID;
  body: string;
  parent_id: UUID | null;
  scheduled_at: string;
  sent_at: string | null;
  created_at: string;
  failed_at?: string | null;
  error?: string | null;
}
export interface AuditLog {
  id: UUID;
  workspace_id: UUID;
  actor_id: UUID;
  action: string;
  target_id: UUID | null;
  details: Record<string, unknown>;
  created_at: string;
}
export interface SearchFilters {
  conversationId?: UUID;
  authorId?: UUID;
  before?: string;
  limit?: number;
  offset?: number;
}
export interface SearchResult extends Message {
  rank?: number;
  headline?: string;
}
export interface PresenceMember {
  userId: UUID;
  status: "online" | "away";
  onlineAt: string;
}
export type ConnectionStatus =
  "connecting" | "connected" | "reconnecting" | "disconnected";

import type { Message, MessageInput, Profile } from "@/lib/types";

/** Persistence always wins over optimistic state for the same id. */
export function reconcileMessages(
  current: Message[],
  incoming: Message[],
): Message[] {
  const map = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    const old = map.get(message.id);
    if (
      old?.delivery === "sent" &&
      message.delivery &&
      message.delivery !== "sent"
    )
      continue;
    // A delayed read must not resurrect a deleted row or replace a newer edit.
    if (old?.deleted_at && !message.deleted_at) continue;
    const oldVersion =
      old?.deleted_at ?? old?.edited_at ?? old?.created_at ?? "";
    const newVersion =
      message.deleted_at ?? message.edited_at ?? message.created_at;
    if (
      old &&
      old.delivery !== "sending" &&
      old.delivery !== "failed" &&
      oldVersion > newVersion
    )
      continue;
    map.set(message.id, {
      ...old,
      ...message,
      delivery: message.delivery ?? "sent",
      error: undefined,
    });
  }
  return Array.from(map.values()).sort((a, b) => {
    const aPending = a.delivery === "sending" || a.delivery === "failed";
    const bPending = b.delivery === "sending" || b.delivery === "failed";
    if (aPending !== bPending) return aPending ? 1 : -1;
    return (
      a.seq - b.seq ||
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id)
    );
  });
}

export function optimisticMessage(
  input: MessageInput,
  author: Profile,
): Message {
  return {
    id: input.id,
    conversation_id: input.conversationId,
    author_id: author.id,
    body: input.body,
    parent_id: input.parentId ?? null,
    seq: Number.MAX_SAFE_INTEGER,
    created_at: new Date().toISOString(),
    edited_at: null,
    deleted_at: null,
    author,
    reactions: [],
    attachments: [],
    delivery: "sending",
  };
}

export function failMessage(
  messages: Message[],
  id: string,
  error: string,
): Message[] {
  return messages.map((message) =>
    message.id === id && message.delivery !== "sent"
      ? { ...message, delivery: "failed", error }
      : message,
  );
}

/** Reconnection replaces the visible persisted window, retaining only unfinished local sends. */
export function recoverMessages(
  current: Message[],
  persisted: Message[],
): Message[] {
  return reconcileMessages(
    current.filter((m) => m.delivery === "sending" || m.delivery === "failed"),
    persisted,
  );
}

export function groupReactions(
  reactions: Message["reactions"],
  userId: string,
) {
  const map = new Map<
    string,
    { emoji: string; count: number; mine: boolean }
  >();
  for (const item of reactions) {
    const group = map.get(item.emoji) ?? {
      emoji: item.emoji,
      count: 0,
      mine: false,
    };
    group.count += 1;
    group.mine ||= item.user_id === userId;
    map.set(item.emoji, group);
  }
  return Array.from(map.values());
}

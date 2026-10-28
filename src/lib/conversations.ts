import type { Conversation } from "./types";
export interface ConversationWithParticipants extends Conversation {
  participants?: {
    user_id: string;
    profile: { display_name: string } | null;
  }[];
}
export function conversationDisplayName(
  row: ConversationWithParticipants,
  userId: string,
): Conversation {
  const { participants, ...conversation } = row;
  if (row.kind !== "dm") return conversation;
  const names = participants
    ?.filter((member) => member.user_id !== userId)
    .map((member) => member.profile?.display_name || "Former teammate");
  return {
    ...conversation,
    name: names?.length ? names.join(", ").slice(0, 80) : "Notes to yourself",
  };
}

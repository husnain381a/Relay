import type { PresenceMember } from "./types";
export interface PresenceRow {
  conversation_id: string;
  user_id: string;
  status: "online" | "away";
  last_seen_at: string;
  typing_until: string | null;
}
/** Expiry uses database timestamps; identity is never supplied by a peer. */
export function resolvePresence(
  rows: PresenceRow[],
  now: number,
  selfId: string,
) {
  const members: PresenceMember[] = [];
  const typing: string[] = [];
  const expirations: number[] = [];
  for (const row of rows) {
    const expires = Date.parse(row.last_seen_at) + 60_000;
    if (!Number.isFinite(expires) || expires <= now) continue;
    members.push({
      userId: row.user_id,
      status: row.status,
      onlineAt: row.last_seen_at,
    });
    expirations.push(expires);
    const typingUntil = row.typing_until ? Date.parse(row.typing_until) : 0;
    if (row.user_id !== selfId && typingUntil > now) {
      typing.push(row.user_id);
      expirations.push(typingUntil);
    }
  }
  return {
    members,
    typing,
    nextExpirationAt: expirations.length ? Math.min(...expirations) : null,
  };
}

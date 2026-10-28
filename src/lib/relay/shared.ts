import type { SupabaseClient } from "@supabase/supabase-js";
export type ClientFactory = () => SupabaseClient;
export const MESSAGE_SELECT =
  "*, author:profiles!messages_author_id_fkey(*), reactions(*), attachments(*)";

export class RelayError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "RelayError";
  }
}
export function checkError(error: { message: string; code?: string } | null) {
  if (error) throw new RelayError(error.message, error.code);
}
export async function rpc<T>(
  getClient: ClientFactory,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await getClient().rpc(name, args);
  checkError(error);
  return data as T;
}

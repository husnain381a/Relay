"use client";
import { getBrowserClient } from "@/lib/supabase/browser";
import { resolvePresence, type PresenceRow } from "@/lib/presence";
import type { ConnectionStatus, PresenceMember } from "@/lib/types";
import { uuid } from "@/lib/validation";
import { createEpochSubscription } from "@/lib/realtime-epoch";
import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";

async function authorizedTopic(
  client: SupabaseClient,
  table: "conversations" | "workspaces",
  id: string,
) {
  const { data, error } = await client
    .from(table)
    .select("realtime_epoch")
    .eq("id", id)
    .maybeSingle();
  if (error)
    throw new Error(
      `Could not authorize real-time access. Apply the current database migrations and try again. ${error.message}`,
    );
  if (!data) return null;
  const epoch = uuid.safeParse(data.realtime_epoch);
  if (!epoch.success)
    throw new Error(
      "Real-time authorization is not configured. Apply the current database migrations.",
    );
  // Refresh the socket token through the browser Auth client, never through peer data.
  const { data: session, error: authError } = await client.auth.getSession();
  if (authError)
    throw new Error("Your session could not be refreshed. Sign in again.");
  await client.realtime.setAuth(session.session?.access_token ?? null);
  return `${table === "conversations" ? "conversation" : "workspace"}:${id}:${epoch.data}`;
}
export interface ConversationSubscription {
  conversationId: string;
  userId: string;
  onChange: (event: {
    recovered: boolean;
    messageId?: string;
    table?: string;
  }) => void;
  onPresence?: (members: PresenceMember[]) => void;
  onTyping?: (userIds: string[]) => void;
  onStatus?: (status: ConnectionStatus) => void;
  onAccessRevoked?: () => void;
  onError?: (message: string) => void;
}
/** Socket events only invalidate state. Messages, identity and presence come from RLS reads. */
export function subscribeConversation(options: ConversationSubscription) {
  uuid.parse(options.conversationId);
  uuid.parse(options.userId);
  const client = getBrowserClient();
  let closed = false;
  let connectedBefore = false;
  let lastTypingSent = 0;
  let away = document.visibilityState !== "visible";
  let presenceRows: PresenceRow[] = [];
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let readTimer: ReturnType<typeof setTimeout> | undefined;
  let writing = Promise.resolve();
  let reading = false;
  let readAgain = false;
  let activeGeneration = () => false;
  const renderPresence = () => {
    clearTimeout(expiryTimer);
    if (closed) return;
    const value = resolvePresence(presenceRows, Date.now(), options.userId);
    options.onPresence?.(value.members);
    options.onTyping?.(value.typing);
    if (value.nextExpirationAt !== null)
      expiryTimer = setTimeout(
        renderPresence,
        Math.max(1, value.nextExpirationAt - Date.now() + 1),
      );
  };
  const readPresence = async () => {
    const current = activeGeneration;
    if (closed || !current()) return;
    if (reading) {
      readAgain = true;
      return;
    }
    reading = true;
    try {
      const { data, error } = await client
        .from("conversation_presence")
        .select("*")
        .eq("conversation_id", options.conversationId);
      if (closed || !current()) return;
      presenceRows = error ? [] : ((data ?? []) as PresenceRow[]);
      renderPresence();
    } finally {
      reading = false;
      if (readAgain && !closed) {
        readAgain = false;
        void readPresence();
      }
    }
  };
  const schedulePresenceRead = () => {
    if (readTimer || closed || !activeGeneration()) return;
    readTimer = setTimeout(() => {
      readTimer = undefined;
      void readPresence();
    }, 120);
  };
  const writePresence = (isTyping = false) => {
    const current = activeGeneration;
    writing = writing
      .catch(() => {})
      .then(async () => {
        if (closed || !current() || !navigator.onLine) return;
        const { error } = await client.rpc("set_presence", {
          p_conversation_id: options.conversationId,
          p_away: away,
          p_typing: isTyping,
        });
        if (closed || !current()) return;
        if (error) {
          presenceRows = [];
          renderPresence();
          if (error.code === "42501")
            options.onChange({
              recovered: false,
              table: "conversation_members",
            });
        } else schedulePresenceRead();
      });
    return writing;
  };
  const subscription = createEpochSubscription<RealtimeChannel>({
    resolveTopic: () =>
      authorizedTopic(client, "conversations", options.conversationId),
    disconnect: (channel) => client.removeChannel(channel),
    onResolving: () => {
      activeGeneration = () => false;
      clearTimeout(readTimer);
      readTimer = undefined;
      presenceRows = [];
      renderPresence();
      options.onStatus?.(connectedBefore ? "reconnecting" : "connecting");
    },
    onDenied: () => {
      options.onStatus?.("disconnected");
      options.onAccessRevoked?.();
      options.onChange({ recovered: true, table: "conversation_members" });
    },
    onError: (error) => {
      options.onStatus?.("disconnected");
      options.onError?.(
        error instanceof Error
          ? error.message
          : "Real-time authorization failed. Try reconnecting.",
      );
    },
    connect: (topic, { isCurrent, rekey }) => {
      activeGeneration = isCurrent;
      const channel = client.channel(topic, {
        config: { private: true, broadcast: { self: false } },
      });
      channel
        .on("broadcast", { event: "rekey" }, () => {
          if (isCurrent()) rekey();
        })
        .on("broadcast", { event: "change" }, ({ payload }) => {
          if (
            !isCurrent() ||
            !payload ||
            payload.conversation_id !== options.conversationId
          )
            return;
          if (payload.table === "conversation_presence") {
            schedulePresenceRead();
            return;
          }
          options.onChange({
            recovered: false,
            messageId:
              typeof payload.message_id === "string"
                ? payload.message_id
                : undefined,
            table:
              typeof payload.table === "string" ? payload.table : undefined,
          });
        })
        .subscribe((status) => {
          if (!isCurrent()) return;
          if (status === "SUBSCRIBED") {
            options.onStatus?.("connected");
            void writePresence();
            void readPresence();
            options.onChange({ recovered: connectedBefore });
            connectedBefore = true;
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            options.onStatus?.("reconnecting");
            presenceRows = [];
            renderPresence();
          } else if (status === "CLOSED") options.onStatus?.("disconnected");
        });
      return channel;
    },
  });
  void subscription.refresh();
  // Protocol heartbeat, not message polling. Expiry timers only inspect cached rows.
  const heartbeat = setInterval(() => {
    if (navigator.onLine) void writePresence();
  }, 25_000);
  const visibility = () => {
    away = document.visibilityState !== "visible";
    void writePresence();
  };
  const offline = () => {
    options.onStatus?.("disconnected");
    presenceRows = [];
    renderPresence();
  };
  const online = () => {
    void subscription.refresh();
  };
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("offline", offline);
  window.addEventListener("online", online);
  return {
    typing() {
      if (!closed && Date.now() - lastTypingSent >= 1500) {
        lastTypingSent = Date.now();
        void writePresence(true);
      }
    },
    setAway(value = false) {
      away = value;
      return writePresence();
    },
    unsubscribe() {
      closed = true;
      clearInterval(heartbeat);
      clearTimeout(expiryTimer);
      clearTimeout(readTimer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
      // Clear after in-flight writes so a delayed heartbeat cannot resurrect us.
      void writing
        .catch(() => {})
        .then(() =>
          client.rpc("clear_presence", {
            p_conversation_id: options.conversationId,
          }),
        )
        .catch(() => {});
      subscription.unsubscribe();
    },
  };
}
export interface UserRealtimeEvent {
  table?: string;
  operation?: string;
  recovered?: boolean;
}
export function subscribeNotifications(
  userId: string,
  onChange: (event?: UserRealtimeEvent) => void,
) {
  uuid.parse(userId);
  const client = getBrowserClient();
  const channel = client
    .channel(`user:${userId}`, { config: { private: true } })
    .on("broadcast", { event: "change" }, ({ payload }) => {
      const event: UserRealtimeEvent = {
        table: typeof payload?.table === "string" ? payload.table : undefined,
        operation:
          typeof payload?.operation === "string"
            ? payload.operation
            : undefined,
      };
      if (event.table === "message_drafts") {
        window.dispatchEvent(
          new CustomEvent("relay:draft-changed", { detail: event }),
        );
        return;
      }
      onChange(event);
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") onChange({ recovered: true });
    });
  return () => {
    void client.removeChannel(channel);
  };
}
export function subscribeWorkspace(
  workspaceId: string,
  onChange: (event: {
    table?: string;
    operation?: string;
    recovered?: boolean;
    revoked?: boolean;
  }) => void,
  onError?: (message: string) => void,
) {
  uuid.parse(workspaceId);
  const client = getBrowserClient();
  const subscription = createEpochSubscription<RealtimeChannel>({
    resolveTopic: () => authorizedTopic(client, "workspaces", workspaceId),
    disconnect: (channel) => client.removeChannel(channel),
    onDenied: () => onChange({ recovered: true, revoked: true }),
    onError: (error) =>
      onError?.(
        error instanceof Error
          ? error.message
          : "Workspace real-time authorization failed.",
      ),
    connect: (topic, { isCurrent, rekey }) => {
      const channel = client
        .channel(topic, { config: { private: true } })
        .on("broadcast", { event: "rekey" }, () => {
          if (isCurrent()) rekey();
        })
        .on(
          "broadcast",
          { event: "change" },
          ({ payload }) =>
            isCurrent() &&
            onChange({
              table:
                typeof payload?.table === "string" ? payload.table : undefined,
              operation:
                typeof payload?.operation === "string"
                  ? payload.operation
                  : undefined,
            }),
        )
        .subscribe((status) => {
          if (isCurrent() && status === "SUBSCRIBED")
            onChange({ recovered: true });
        });
      return channel;
    },
  });
  void subscription.refresh();
  const online = () => {
    void subscription.refresh();
  };
  window.addEventListener("online", online);
  return () => {
    window.removeEventListener("online", online);
    subscription.unsubscribe();
  };
}

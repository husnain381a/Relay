"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  Hash,
  Info,
  LockKeyhole,
  Menu,
  MessageCircle,
  Pin,
  Users,
  X,
  Bell,
  BellOff,
} from "lucide-react";
import type {
  Conversation,
  Message,
  Profile,
  WorkspaceMember,
  ConnectionStatus,
  Pin as Pinned,
  ThreadSummary,
} from "@/lib/types";
import { relay } from "@/lib/relay";
import {
  failMessage,
  optimisticMessage,
  reconcileMessages,
} from "@/lib/messages";
import { subscribeConversation } from "@/lib/realtime";
import { Composer } from "./composer";
import { MessageCard, type MessageAction } from "./message-card";
import { Avatar, Empty, IconButton } from "./ui";

export function ConversationView({
  conversation,
  profile,
  members,
  savedIds,
  jumpMessageId,
  openThreadId,
  channels,
  onAction,
  onDetails,
  onMobileMenu,
  onError,
}: {
  conversation: Conversation;
  profile: Profile;
  members: WorkspaceMember[];
  savedIds: Set<string>;
  jumpMessageId?: string;
  openThreadId?: string;
  channels: Conversation[];
  onAction: (action: MessageAction, message: Message) => void;
  onDetails: () => void;
  onMobileMenu: () => void;
  onError: (error: string) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [replies, setReplies] = useState<Record<string, number>>({});
  const [summaries, setSummaries] = useState<Record<string, ThreadSummary>>({});
  const [pins, setPins] = useState<Pinned[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState("");
  const [thread, setThread] = useState<Message | null>(null);
  const [threadMessages, setThreadMessages] = useState<Message[]>([]);
  const [threadNext, setThreadNext] = useState<number | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [online, setOnline] = useState<string[]>([]);
  const [typing, setTyping] = useState<string[]>([]);
  const [tab, setTab] = useState<"messages" | "pins">("messages");
  const scroll = useRef<HTMLDivElement>(null);
  const threadScroll = useRef<HTMLDivElement>(null);
  const subscription = useRef<ReturnType<typeof subscribeConversation> | null>(
    null,
  );
  const threadRef = useRef<Message | null>(null);
  const currentId = useRef(conversation.id);
  const nearBottom = useRef(true);
  const threadAtBottom = useRef(true);
  const [newBelow, setNewBelow] = useState(false);
  const messageRef = useRef<Message[]>([]);
  const replyRef = useRef<Message[]>([]);
  const syncing = useRef(false);
  const queued = useRef(false);
  const mounted = useRef(true);
  const pendingFiles = useRef(new Map<string, File[]>());
  const [failedUploads, setFailedUploads] = useState<
    { messageId: string; file: File; error: string }[]
  >([]);
  messageRef.current = messages;
  replyRef.current = threadMessages;
  const virtual = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 92,
    overscan: 10,
    getItemKey: (index) => messages[index].id,
  });
  const scrollBottom = useCallback(() => {
    requestAnimationFrame(() => {
      virtual.scrollToIndex(messages.length - 1, { align: "end" });
      setNewBelow(false);
    });
  }, [messages.length, virtual]);
  const refresh = useCallback(async () => {
    const id = conversation.id;
    if (syncing.current) {
      queued.current = true;
      return;
    }
    syncing.current = true;
    try {
      const [persisted, counts, pinned, summary] = await Promise.all([
        relay.synchronizeMessages(id, messageRef.current),
        relay.replyCounts(id),
        relay.pins(id),
        relay.threadSummaries(id),
      ]);
      if (!mounted.current || currentId.current !== id) return;
      setMessages((old) =>
        reconcileMessages(
          old.filter(
            (m) => m.delivery === "sending" || m.delivery === "failed",
          ),
          persisted,
        ),
      );
      setReplies(counts);
      setSummaries(summary);
      setPins(pinned);
      const parentId = threadRef.current?.id;
      if (parentId) {
        const synced = await relay.synchronizeMessages(
          id,
          replyRef.current,
          parentId,
        );
        const parent = await relay.message(parentId);
        if (!mounted.current || threadRef.current?.id !== parentId) return;
        setThreadMessages((old) =>
          reconcileMessages(
            old.filter(
              (m) => m.delivery === "sending" || m.delivery === "failed",
            ),
            synced,
          ),
        );
        if (parent) setThread(parent);
        const sentReplies = synced.filter(
          (m) => m.delivery !== "sending" && m.delivery !== "failed",
        );
        if (
          document.visibilityState === "visible" &&
          threadAtBottom.current &&
          sentReplies.length
        )
          await relay.markThreadRead(
            parentId,
            Math.max(...sentReplies.map((m) => m.seq)),
          );
      }
      const sent = persisted.filter(
        (m) => m.delivery !== "sending" && m.delivery !== "failed",
      );
      if (
        document.visibilityState === "visible" &&
        nearBottom.current &&
        sent.length
      )
        await relay.markRead(id, Math.max(...sent.map((m) => m.seq)));
      setError("");
    } catch (err) {
      if (mounted.current && currentId.current === id) {
        setError(
          err instanceof Error ? err.message : "Could not refresh messages.",
        );
        if (err instanceof Error && /no longer have access/.test(err.message)) {
          setMessages([]);
          setThreadMessages([]);
          setThread(null);
          threadRef.current = null;
        }
      }
    } finally {
      syncing.current = false;
      if (queued.current && mounted.current) {
        queued.current = false;
        void refresh();
      }
    }
  }, [conversation.id]);
  useEffect(() => {
    let active = true;
    mounted.current = true;
    currentId.current = conversation.id;
    setLoading(true);
    setError("");
    setMessages([]);
    setThread(null);
    threadRef.current = null;
    setTab("messages");
    nearBottom.current = true;
    relay
      .messages(conversation.id)
      .then((page) => {
        if (active) {
          setMessages((old) => reconcileMessages(page.messages, old));
          setNext(page.nextCursor);
          setLoading(false);
          if (page.messages.length)
            void relay
              .markRead(
                conversation.id,
                Math.max(...page.messages.map((m) => m.seq)),
              )
              .catch((err) => {
                if (active) setError(err.message);
              });
        }
      })
      .catch((err) => {
        if (active) {
          setError(err.message);
          setLoading(false);
        }
      });
    const sub = subscribeConversation({
      conversationId: conversation.id,
      userId: profile.id,
      onChange: () => {
        if (active) void refresh();
      },
      onPresence: (p) => {
        if (active)
          setOnline(
            p.filter((m) => m.status === "online").map((m) => m.userId),
          );
      },
      onTyping: (users) => {
        if (active) setTyping(users);
      },
      onStatus: (s) => {
        if (active) setStatus(s);
      },
      onError: onError,
      onAccessRevoked: () => {
        if (active) {
          setMessages([]);
          setThreadMessages([]);
          setThread(null);
          threadRef.current = null;
          setError("You no longer have access to this conversation.");
        }
      },
    });
    subscription.current = sub;
    const focus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const changed = () => {
      void refresh();
    };
    document.addEventListener("visibilitychange", focus);
    window.addEventListener("relay:refresh", changed);
    return () => {
      active = false;
      mounted.current = false;
      sub.unsubscribe();
      subscription.current = null;
      document.removeEventListener("visibilitychange", focus);
      window.removeEventListener("relay:refresh", changed);
    };
  }, [conversation.id, profile.id, refresh]);
  useEffect(() => {
    if (nearBottom.current) scrollBottom();
    else setNewBelow(true);
  }, [messages.length]);
  const openThread = async (message: Message) => {
    setThread(message);
    threadRef.current = message;
    setThreadMessages([]);
    threadAtBottom.current = true;
    try {
      const page = await relay.messages(conversation.id, {
        parentId: message.id,
      });
      if (threadRef.current?.id === message.id) {
        setThreadMessages(page.messages);
        setThreadNext(page.nextCursor);
        requestAnimationFrame(() => {
          if (threadScroll.current)
            threadScroll.current.scrollTop = threadScroll.current.scrollHeight;
        });
        if (document.visibilityState === "visible" && page.messages.length) {
          await relay.markThreadRead(
            message.id,
            Math.max(...page.messages.map((m) => m.seq)),
          );
          setSummaries((old) =>
            old[message.id]
              ? {
                  ...old,
                  [message.id]: { ...old[message.id], unread_count: 0 },
                }
              : old,
          );
        }
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not load thread.");
    }
  };
  useEffect(() => {
    if (!openThreadId || loading) return;
    let active = true;
    relay
      .message(openThreadId)
      .then((root) => {
        if (
          active &&
          root &&
          root.conversation_id === conversation.id &&
          !root.parent_id
        )
          void openThread(root);
      })
      .catch((err) => {
        if (active) onError(err.message);
      });
    return () => {
      active = false;
    };
  }, [openThreadId, loading]);
  useEffect(() => {
    if (!jumpMessageId || loading) return;
    let active = true;
    void (async () => {
      try {
        const target = await relay.message(jumpMessageId);
        if (!active || !target || target.conversation_id !== conversation.id)
          return;
        if (target.parent_id) {
          const parent = await relay.message(target.parent_id);
          if (parent && active) await openThread(parent);
        } else {
          const page = await relay.messages(conversation.id, {
            before: target.seq + 1,
          });
          if (!active) return;
          nearBottom.current = false;
          setMessages(page.messages);
          setNext(page.nextCursor);
          requestAnimationFrame(() => {
            virtual.scrollToIndex(
              page.messages.findIndex((m) => m.id === target.id),
              { align: "center" },
            );
          });
        }
      } catch (err) {
        if (active)
          onError(
            err instanceof Error ? err.message : "Could not locate message.",
          );
      }
    })();
    return () => {
      active = false;
    };
  }, [jumpMessageId, loading]);
  const action = (type: MessageAction, message: Message) => {
    if (type === "thread") void openThread(message);
    else if (type === "retry")
      void send(
        message.body,
        pendingFiles.current.get(message.id) || [],
        message.parent_id || undefined,
        undefined,
        message.id,
      ).catch(() => {});
    else onAction(type, message);
  };
  const send = async (
    body: string,
    files: File[],
    parentId?: string,
    scheduledAt?: string,
    retryId?: string,
  ) => {
    const id = retryId || crypto.randomUUID();
    const input = { id, conversationId: conversation.id, body, parentId };
    if (scheduledAt) {
      await relay.scheduleMessage({ ...input, scheduledAt });
      return;
    }
    const optimistic = optimisticMessage(input, profile);
    if (files.length) pendingFiles.current.set(id, files);
    const set = parentId ? setThreadMessages : setMessages;
    const activeTarget = () =>
      mounted.current && (!parentId || threadRef.current?.id === parentId);
    set((old) =>
      reconcileMessages(
        old.filter((m) => m.id !== id),
        [optimistic],
      ),
    );
    nearBottom.current = true;
    try {
      await relay.sendMessage(input);
      window.dispatchEvent(
        new CustomEvent("relay:message-sent", {
          detail: { id, body, conversationId: conversation.id, parentId },
        }),
      );
      for (const file of files) {
        try {
          await relay.uploadAttachment(file, conversation.id, id);
        } catch (err) {
          setFailedUploads((old) => [
            ...old,
            {
              messageId: id,
              file,
              error: err instanceof Error ? err.message : "Upload failed.",
            },
          ]);
        }
      }
      pendingFiles.current.delete(id);
      const persisted = await relay.message(id);
      if (persisted && activeTarget())
        set((old) => reconcileMessages(old, [persisted]));
      await refresh();
    } catch (err) {
      const text =
        err instanceof Error ? err.message : "Could not send. Try again.";
      if (activeTarget()) set((old) => failMessage(old, id, text));
      onError(
        "Your draft is kept. Retry the message or send the unchanged draft again to reuse its message ID.",
      );
      throw err;
    }
  };
  const react = async (id: string, emoji: string) => {
    try {
      await relay.toggleReaction(id, emoji);
      await refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not add reaction.");
    }
  };
  const displayName =
    conversation.kind === "dm" ? conversation.name : `#${conversation.name}`;
  const pinIds = new Set(pins.map((p) => p.message_id));
  const row = (message: Message, i: number, collection = messages) => (
    <MessageCard
      message={message}
      userId={profile.id}
      replyCount={replies[message.id] || 0}
      threadSummary={summaries[message.id]}
      saved={savedIds.has(message.id)}
      pinned={pinIds.has(message.id)}
      online={online.includes(message.author_id)}
      compact={
        i > 0 &&
        collection[i - 1].author_id === message.author_id &&
        new Date(message.created_at).getTime() -
          new Date(collection[i - 1].created_at).getTime() <
          300000 &&
        new Date(message.created_at).toDateString() ===
          new Date(collection[i - 1].created_at).toDateString()
      }
      onAction={action}
      onReact={(id, emoji) => void react(id, emoji)}
      onError={onError}
    />
  );
  return (
    <>
      <section className="conversation">
        <header className="conversation-header">
          <IconButton
            label="Open navigation"
            className="mobile-menu"
            onClick={onMobileMenu}
          >
            <Menu size={20} />
          </IconButton>
          <button className="conversation-title" onClick={onDetails}>
            {conversation.kind === "private" ? (
              <LockKeyhole size={21} />
            ) : conversation.kind === "dm" ? (
              <MessageCircle size={21} />
            ) : (
              <Hash size={23} />
            )}
            <h1>{conversation.name}</h1>
          </button>
          <div className="conversation-header-right">
            <span
              className={`connection-status ${status}`}
              title="Real-time connection status"
            >
              <span />
              {status === "connected"
                ? "Connected"
                : status === "connecting"
                  ? "Connecting"
                  : "Reconnecting"}
            </span>
            <button className="members-button" onClick={onDetails}>
              <Users size={16} />
              <span>Members</span>
            </button>
            <IconButton label="Conversation details" onClick={onDetails}>
              <Info size={19} />
            </IconButton>
          </div>
        </header>
        <div className="conversation-tabs">
          <button
            className={tab === "messages" ? "active" : ""}
            onClick={() => setTab("messages")}
          >
            <MessageCircle size={15} />
            Messages
          </button>
          <button
            className={tab === "pins" ? "active" : ""}
            onClick={() => setTab("pins")}
          >
            <Pin size={14} />
            Pinned<span>{pins.length || ""}</span>
          </button>
          <span>
            {conversation.topic ||
              conversation.description ||
              "A little more connected."}
          </span>
        </div>
        {error && (
          <div className="inline-error" role="alert">
            {error}
            <button onClick={() => void refresh()}>Reconnect</button>
          </div>
        )}
        {tab === "pins" ? (
          <div className="pins-list">
            {pins.length ? (
              pins.map((p, i) => (
                <div key={p.message_id}>
                  {row(
                    p.message,
                    i,
                    pins.map((item) => item.message),
                  )}
                </div>
              ))
            ) : (
              <Empty
                icon={<Pin size={29} />}
                title="The important things, close at hand."
              >
                Pin a message from its menu and your team will find it here.
              </Empty>
            )}
          </div>
        ) : (
          <>
            <div
              className="message-scroll"
              ref={scroll}
              onScroll={(e) => {
                const el = e.currentTarget;
                nearBottom.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 140;
                if (nearBottom.current) setNewBelow(false);
              }}
            >
              {loading ? (
                <div className="message-skeleton" aria-label="Loading messages">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i}>
                      <span />
                      <p />
                      <p />
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  {next && (
                    <div className="load-older">
                      <button
                        disabled={loadingOlder}
                        onClick={async () => {
                          setLoadingOlder(true);
                          try {
                            const page = await relay.messages(conversation.id, {
                              before: next,
                            });
                            nearBottom.current = false;
                            setMessages((old) =>
                              reconcileMessages(page.messages, old),
                            );
                            setNext(page.nextCursor);
                          } catch (err) {
                            onError(
                              err instanceof Error
                                ? err.message
                                : "Could not load older messages.",
                            );
                          } finally {
                            setLoadingOlder(false);
                          }
                        }}
                      >
                        {loadingOlder ? "Loading…" : "Load earlier messages"}
                      </button>
                    </div>
                  )}
                  {!next && (
                    <div className="conversation-intro">
                      <div className="intro-icon">
                        {conversation.kind === "private" ? (
                          <LockKeyhole size={31} />
                        ) : conversation.kind === "dm" ? (
                          <MessageCircle size={31} />
                        ) : (
                          <Hash size={36} />
                        )}
                      </div>
                      <h2>
                        {conversation.kind === "dm"
                          ? conversation.name
                          : `Welcome to #${conversation.name}`}
                      </h2>
                      <p>
                        {conversation.description ||
                          (conversation.kind === "dm"
                            ? "A direct line. A little space to talk things through."
                            : "This is the beginning of something good. Share an update, ask a question, or start a conversation.")}
                      </p>
                      {!messages.length && (
                        <span className="first-message-note">
                          Every great team starts somewhere. Say hello.
                        </span>
                      )}
                    </div>
                  )}
                  <div
                    className="virtual-list"
                    style={{ height: virtual.getTotalSize() }}
                  >
                    {virtual.getVirtualItems().map((item) => {
                      const msg = messages[item.index];
                      return (
                        <div
                          key={msg.id}
                          data-index={item.index}
                          ref={virtual.measureElement}
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            transform: `translateY(${item.start}px)`,
                          }}
                        >
                          {(item.index === 0 ||
                            new Date(msg.created_at).toDateString() !==
                              new Date(
                                messages[item.index - 1].created_at,
                              ).toDateString()) && (
                            <div className="day-divider">
                              <span>
                                {new Date(msg.created_at).toLocaleDateString(
                                  [],
                                  {
                                    weekday: "long",
                                    month: "long",
                                    day: "numeric",
                                  },
                                )}
                              </span>
                            </div>
                          )}
                          {row(msg, item.index)}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            {newBelow && (
              <button className="new-messages" onClick={scrollBottom}>
                New messages
                <ArrowDown size={14} />
              </button>
            )}
            <div className="typing-indicator" role="status">
              {typing.length > 0 && (
                <>
                  <span className="typing-dots">•••</span>
                  {typing
                    .map(
                      (id) =>
                        members.find((m) => m.user_id === id)?.profile
                          ?.display_name || "A teammate",
                    )
                    .slice(0, 3)
                    .join(", ")}{" "}
                  {typing.length === 1 ? "is" : "are"} typing
                </>
              )}
            </div>
            {failedUploads.length > 0 && (
              <div className="upload-retries">
                {failedUploads.map((upload, index) => (
                  <div
                    role="alert"
                    key={`${upload.messageId}-${upload.file.name}-${index}`}
                  >
                    <span>
                      {upload.file.name}: {upload.error}
                    </span>
                    <button
                      onClick={async () => {
                        try {
                          await relay.uploadAttachment(
                            upload.file,
                            conversation.id,
                            upload.messageId,
                          );
                          setFailedUploads((old) =>
                            old.filter((item) => item !== upload),
                          );
                          await refresh();
                        } catch (err) {
                          onError(
                            err instanceof Error
                              ? err.message
                              : "Upload still failed.",
                          );
                        }
                      }}
                    >
                      Retry upload
                    </button>
                    <button
                      onClick={() =>
                        setFailedUploads((old) =>
                          old.filter((item) => item !== upload),
                        )
                      }
                    >
                      Dismiss
                    </button>
                  </div>
                ))}
              </div>
            )}
            <Composer
              key={`${profile.id}:${conversation.id}:main`}
              conversationId={conversation.id}
              userId={profile.id}
              label={displayName}
              members={members}
              channels={channels}
              disabled={!!conversation.archived_at}
              onTyping={() => subscription.current?.typing()}
              onSend={(body, files, date, id) =>
                send(body, files, undefined, date, id)
              }
            />
          </>
        )}
      </section>
      {thread && (
        <aside className="thread-panel">
          <header>
            <h2>
              Thread<span>{displayName}</span>
            </h2>
            <IconButton
              label="Close thread"
              onClick={() => {
                setThread(null);
                threadRef.current = null;
              }}
            >
              <X size={19} />
            </IconButton>
          </header>
          <div className="thread-follow-bar">
            <span className="thread-participants">
              {summaries[thread.id]?.participants?.slice(0, 4).map((p) => (
                <Avatar
                  key={p.id}
                  small
                  name={p.display_name}
                  url={p.avatar_url}
                  avatarPath={p.avatar_path}
                />
              ))}
            </span>
            <button
              onClick={async () => {
                try {
                  const following = !summaries[thread.id]?.following;
                  await relay.followThread(thread.id, following);
                  await refresh();
                } catch (err) {
                  onError(
                    err instanceof Error
                      ? err.message
                      : "Could not update thread notifications.",
                  );
                }
              }}
            >
              {summaries[thread.id]?.following ? (
                <BellOff size={13} />
              ) : (
                <Bell size={13} />
              )}
              {summaries[thread.id]?.following
                ? "Unfollow thread"
                : "Follow thread"}
            </button>
          </div>
          <div
            className="thread-body"
            ref={threadScroll}
            onScroll={(event) => {
              const el = event.currentTarget;
              threadAtBottom.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
          >
            {row(thread, 0, [thread])}
            <div className="thread-divider">
              {replies[thread.id] || threadMessages.length} replies
            </div>
            {threadNext && (
              <button
                className="text-link"
                onClick={async () => {
                  try {
                    const page = await relay.messages(conversation.id, {
                      parentId: thread.id,
                      before: threadNext,
                    });
                    setThreadMessages((old) =>
                      reconcileMessages(page.messages, old),
                    );
                    setThreadNext(page.nextCursor);
                  } catch (err) {
                    onError(
                      err instanceof Error
                        ? err.message
                        : "Could not load replies.",
                    );
                  }
                }}
              >
                Load earlier replies
              </button>
            )}
            {threadMessages.map((m, i) => (
              <div key={m.id}>{row(m, i, threadMessages)}</div>
            ))}
          </div>
          <Composer
            key={`${profile.id}:${thread.id}`}
            conversationId={conversation.id}
            userId={profile.id}
            parentId={thread.id}
            label="thread"
            members={members}
            channels={channels}
            onTyping={() => subscription.current?.typing()}
            disabled={!!conversation.archived_at}
            onSend={(body, files, date, id) =>
              send(body, files, thread.id, date, id)
            }
          />
        </aside>
      )}
    </>
  );
}

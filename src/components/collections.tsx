"use client";
import { useEffect, useRef, useState } from "react";
import {
  appendUnique,
  createRequestGuard,
  type OffsetPage,
} from "@/lib/pagination";
import {
  Bell,
  Bookmark,
  CalendarClock,
  Check,
  FileText,
  Hash,
  LoaderCircle,
  MessageCircle,
  Search,
} from "lucide-react";
import { relay } from "@/lib/relay";
import type {
  Attachment,
  Conversation,
  Message,
  Notification,
  Profile,
  SavedMessage,
  ScheduledMessage,
  ThreadSummary,
  WorkspaceMember,
} from "@/lib/types";
import { Avatar, Empty, Modal } from "./ui";
import { MessageCard, type MessageAction } from "./message-card";

export function SearchDialog({
  open,
  close,
  workspaceId,
  conversations,
  members,
  onNavigate,
  onError,
}: {
  open: boolean;
  close: () => void;
  workspaceId?: string;
  conversations: Conversation[];
  members: WorkspaceMember[];
  onNavigate: (id: string, messageId?: string) => void;
  onError: (s: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState("");
  const [author, setAuthor] = useState("");
  const [date, setDate] = useState("");
  const [tab, setTab] = useState("messages");
  const [results, setResults] = useState<Message[]>([]);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const requests = useRef(createRequestGuard());
  const scope = JSON.stringify([
    open,
    workspaceId,
    query,
    channel,
    author,
    date,
    tab,
  ]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const invalidate = () => {
    requests.current.invalidate();
    setResults([]);
    setFiles([]);
    setOffset(0);
    setMore(false);
    setBusy(false);
    setError("");
  };
  const safeClose = () => {
    requests.current.invalidate();
    close();
  };
  const run = async (append = false) => {
    if (!workspaceId || !query.trim() || busy || (append && !more)) return;
    const ticket = requests.current.begin();
    const requestedScope = scope;
    const start = append ? offset : 0;
    const current = () => ticket() && currentScope.current === requestedScope;
    setBusy(true);
    setError("");
    try {
      if (tab === "messages") {
        const found = await relay.search(workspaceId, query, {
          conversationId: channel || undefined,
          authorId: author || undefined,
          before: date
            ? new Date(`${date}T23:59:59Z`).toISOString()
            : undefined,
          offset: start,
          limit: 31,
        });
        if (!current()) return;
        const visible = found.slice(0, 30);
        setResults((rows) =>
          append ? appendUnique(rows, visible, (row) => row.id) : visible,
        );
        setMore(found.length > 30);
        setOffset(start + visible.length);
      } else if (tab === "files") {
        const page = await relay.filesPage(workspaceId, query, {
          offset: start,
          limit: 30,
        });
        if (!current()) return;
        setFiles((rows) =>
          append ? appendUnique(rows, page.items, (row) => row.id) : page.items,
        );
        setMore(page.hasMore);
        setOffset(page.nextOffset ?? start + page.items.length);
      }
    } catch (err) {
      if (!current()) return;
      setError(
        err instanceof Error ? err.message : "Search failed. Try again.",
      );
    } finally {
      if (current()) setBusy(false);
    }
  };
  useEffect(() => {
    requests.current.invalidate();
    setBusy(false);
    if (open) {
      setQuery("");
      setChannel("");
      setAuthor("");
      setDate("");
      setTab("messages");
      setResults([]);
      setFiles([]);
      setOffset(0);
      setMore(false);
      setError("");
    }
    return () => requests.current.invalidate();
  }, [open, workspaceId]);
  const highlight = (text: string) => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return text
      .split(/(\s+)/)
      .map((word, i) =>
        terms.some((t) => word.toLowerCase().includes(t)) ? (
          <mark key={i}>{word}</mark>
        ) : (
          word
        ),
      );
  };
  return (
    <Modal
      title="Find the conversation"
      description="Search the messages, people, channels, and files you have access to."
      open={open}
      onClose={safeClose}
      wide
    >
      <form
        className="search-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <Search size={20} />
        <input
          aria-label="Search workspace"
          autoFocus
          value={query}
          onChange={(e) => {
            invalidate();
            setQuery(e.target.value);
          }}
          placeholder="What are you looking for?"
          required
        />
        <button className="primary" disabled={busy || !query.trim()}>
          {busy ? "Searching…" : "Search"}
        </button>
      </form>
      <div className="search-tabs">
        {[
          ["messages", "Messages"],
          ["channels", "Channels"],
          ["people", "People"],
          ["files", "Files"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => {
              invalidate();
              setTab(id);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "messages" && (
        <div className="search-filters">
          <select
            aria-label="Filter by channel"
            value={channel}
            onChange={(e) => {
              invalidate();
              setChannel(e.target.value);
            }}
          >
            <option value="">In any conversation</option>
            {conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by sender"
            value={author}
            onChange={(e) => {
              invalidate();
              setAuthor(e.target.value);
            }}
          >
            <option value="">From anyone</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.profile?.display_name}
              </option>
            ))}
          </select>
          <input
            aria-label="Sent before date"
            type="date"
            value={date}
            onChange={(e) => {
              invalidate();
              setDate(e.target.value);
            }}
          />
        </div>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="search-results">
        {tab === "messages" &&
          results.map((m) => (
            <button
              className="search-result"
              key={m.id}
              onClick={() => {
                onNavigate(m.conversation_id, m.id);
                close();
              }}
            >
              <div className="result-context">
                <Hash size={14} />
                {conversations.find((c) => c.id === m.conversation_id)?.name ||
                  "Conversation"}
                <span>{new Date(m.created_at).toLocaleDateString()}</span>
              </div>
              <strong>
                {members.find((item) => item.user_id === m.author_id)?.profile
                  ?.display_name || "Teammate"}
              </strong>
              <p>{highlight(m.body)}</p>
            </button>
          ))}
        {tab === "channels" &&
          conversations
            .filter(
              (c) =>
                c.kind !== "dm" &&
                c.name.toLowerCase().includes(query.toLowerCase()),
            )
            .map((c) => (
              <button
                className="search-result channel-result"
                key={c.id}
                onClick={() => {
                  onNavigate(c.id);
                  close();
                }}
              >
                <Hash size={20} />
                <span>
                  <strong>{highlight(c.name)}</strong>
                  <p>{c.description}</p>
                </span>
              </button>
            ))}
        {tab === "people" &&
          members
            .filter((m) =>
              `${m.profile?.display_name} ${m.profile?.username}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            )
            .map((m) => (
              <div className="people-result" key={m.user_id}>
                <Avatar
                  name={m.profile?.display_name}
                  url={m.profile?.avatar_url}
                  avatarPath={m.profile?.avatar_path}
                />
                <span>
                  <strong>{highlight(m.profile?.display_name || "")}</strong>
                  <p>
                    @{m.profile?.username} · {m.profile?.title || m.role}
                  </p>
                </span>
                <button
                  className="secondary"
                  onClick={async () => {
                    if (!workspaceId) return;
                    const requestedScope = currentScope.current;
                    try {
                      const c = await relay.createConversation({
                        workspaceId,
                        name: m.profile?.display_name || "Direct message",
                        kind: "dm",
                        memberIds: [m.user_id],
                      });
                      if (currentScope.current !== requestedScope) return;
                      onNavigate(c.id);
                      close();
                    } catch (err) {
                      if (currentScope.current !== requestedScope) return;
                      onError(
                        err instanceof Error
                          ? err.message
                          : "Could not open conversation.",
                      );
                    }
                  }}
                >
                  Message
                </button>
              </div>
            ))}
        {tab === "files" &&
          files.map((file) => (
            <button
              className="search-result channel-result"
              key={file.id}
              onClick={async () => {
                const requestedScope = currentScope.current;
                try {
                  const url = await relay.signedAttachmentUrl(file, true);
                  if (currentScope.current !== requestedScope) return;
                  window.open(url, "_blank", "noopener,noreferrer");
                } catch (err) {
                  if (currentScope.current !== requestedScope) return;
                  onError(
                    err instanceof Error ? err.message : "Could not open file.",
                  );
                }
              }}
            >
              <FileText size={22} />
              <span>
                <strong>{highlight(file.name)}</strong>
                <p>{(file.size / 1024).toFixed(0)} KB</p>
              </span>
            </button>
          ))}
        {busy && (
          <div className="search-loading">
            <LoaderCircle className="spin" size={22} />
            Searching your workspace…
          </div>
        )}
        {!busy &&
          ((tab === "messages" && !results.length) ||
            (tab === "files" && !files.length)) && (
            <Empty
              icon={<Search size={30} />}
              title="A thought, a file, a familiar face."
            >
              Enter your search above. Results only include content you’re
              authorized to read.
            </Empty>
          )}
        {more && (tab === "messages" || tab === "files") && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void run(true)}
          >
            Load more results
          </button>
        )}
      </div>
    </Modal>
  );
}

export function CollectionView({
  view,
  workspaceId,
  profile,
  conversations,
  notifications,
  savedIds,
  onAction,
  onNavigate,
  onError,
  onRefresh,
}: {
  view: string;
  workspaceId: string;
  profile: Profile;
  conversations: Conversation[];
  notifications: Notification[];
  savedIds: Set<string>;
  onAction: (a: MessageAction, m: Message) => void;
  onNavigate: (id: string, messageId?: string) => void;
  onError: (s: string) => void;
  onRefresh: () => void;
}) {
  const [saved, setSaved] = useState<SavedMessage[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledMessage[]>([]);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [activity, setActivity] = useState<Notification[]>([]);
  const [threads, setThreads] = useState<Message[]>([]);
  const [threadMetadata, setThreadMetadata] = useState<
    Record<string, ThreadSummary>
  >({});
  type CollectionKind =
    "saved" | "scheduled" | "files" | "activity" | "threads";
  const [loading, setLoading] = useState<Record<CollectionKind, boolean>>({
    saved: false,
    scheduled: false,
    files: false,
    activity: false,
    threads: false,
  });
  const [pages, setPages] = useState<
    Record<CollectionKind, { hasMore: boolean; nextOffset: number | null }>
  >({
    saved: { hasMore: false, nextOffset: null },
    scheduled: { hasMore: false, nextOffset: null },
    files: { hasMore: false, nextOffset: null },
    activity: { hasMore: false, nextOffset: null },
    threads: { hasMore: false, nextOffset: null },
  });
  const requests = useRef({
    saved: createRequestGuard(),
    scheduled: createRequestGuard(),
    files: createRequestGuard(),
    activity: createRequestGuard(),
    threads: createRequestGuard(),
  });
  const savedFingerprint =
    view === "later" ? [...savedIds].sort().join("|") : "";
  const scope = JSON.stringify([
    view,
    workspaceId,
    profile.id,
    savedFingerprint,
  ]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const latestNotifications = useRef(notifications);
  latestNotifications.current = notifications;
  const [error, setError] = useState("");
  const load = async (kind: CollectionKind, append = false) => {
    const offset = append ? pages[kind].nextOffset : 0;
    if (offset === null || (append && loading[kind])) return;
    const ticket = requests.current[kind].begin();
    const requestedScope = scope;
    const current = () => ticket() && currentScope.current === requestedScope;
    setLoading((value) => ({ ...value, [kind]: true }));
    try {
      const options = { offset, limit: 30 };
      const page: OffsetPage<
        SavedMessage | ScheduledMessage | Attachment | Notification | Message
      > =
        kind === "saved"
          ? await relay.savedPage(workspaceId, options)
          : kind === "scheduled"
            ? await relay.scheduledPage(workspaceId, options)
            : kind === "files"
              ? await relay.filesPage(workspaceId, "", options)
              : kind === "threads"
                ? await relay.subscribedThreadsPage(workspaceId, options)
                : await relay.notificationsPage(workspaceId, options);
      if (!current()) return;
      if (kind === "threads") {
        const roots = page.items as Message[];
        const summaries = await Promise.all(
          [...new Set(roots.map((root) => root.conversation_id))].map((id) =>
            relay.threadSummaries(id),
          ),
        );
        if (!current()) return;
        const metadata = Object.assign({}, ...summaries) as Record<
          string,
          ThreadSummary
        >;
        setThreads((rows) =>
          append ? appendUnique(rows, roots, (row) => row.id) : roots,
        );
        setThreadMetadata((rows) =>
          append ? { ...rows, ...metadata } : metadata,
        );
      }
      if (kind === "saved")
        setSaved((rows) =>
          append
            ? appendUnique(
                rows,
                page.items as SavedMessage[],
                (row) => row.message_id,
              )
            : (page.items as SavedMessage[]),
        );
      if (kind === "scheduled")
        setScheduled((rows) =>
          append
            ? appendUnique(
                rows,
                page.items as ScheduledMessage[],
                (row) => row.id,
              )
            : (page.items as ScheduledMessage[]),
        );
      if (kind === "files")
        setFiles((rows) =>
          append
            ? appendUnique(rows, page.items as Attachment[], (row) => row.id)
            : (page.items as Attachment[]),
        );
      if (kind === "activity") {
        const latest = new Map(
          latestNotifications.current
            .filter(
              (n) => n.workspace_id === workspaceId && n.user_id === profile.id,
            )
            .map((n) => [n.id, n]),
        );
        const items = (page.items as Notification[]).map(
          (n) => latest.get(n.id) ?? n,
        );
        setActivity((rows) =>
          append ? appendUnique(rows, items, (row) => row.id) : items,
        );
      }
      setPages((value) => ({
        ...value,
        [kind]: { hasMore: page.hasMore, nextOffset: page.nextOffset },
      }));
    } catch (err) {
      if (!current()) return;
      setError(
        err instanceof Error ? err.message : "Could not load this collection.",
      );
    } finally {
      if (current()) setLoading((value) => ({ ...value, [kind]: false }));
    }
  };
  const reload = () => {
    setError("");
    if (view === "later") {
      void load("saved");
      void load("scheduled");
    } else
      void load(
        view === "files"
          ? "files"
          : view === "threads"
            ? "threads"
            : "activity",
      );
  };
  useEffect(() => {
    for (const request of Object.values(requests.current)) request.invalidate();
    setSaved([]);
    setScheduled([]);
    setFiles([]);
    setActivity([]);
    setThreads([]);
    setThreadMetadata({});
    setError("");
    setLoading({
      saved: false,
      scheduled: false,
      files: false,
      activity: false,
      threads: false,
    });
    setPages({
      saved: { hasMore: false, nextOffset: null },
      scheduled: { hasMore: false, nextOffset: null },
      files: { hasMore: false, nextOffset: null },
      activity: { hasMore: false, nextOffset: null },
      threads: { hasMore: false, nextOffset: null },
    });
    reload();
    return () => {
      for (const request of Object.values(requests.current))
        request.invalidate();
    };
  }, [view, workspaceId, profile.id, savedFingerprint]);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => reloadRef.current(), 180);
    };
    window.addEventListener("relay:refresh", refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("relay:refresh", refresh);
    };
  }, []);
  const busy =
    view === "later"
      ? (loading.saved && !saved.length) ||
        (loading.scheduled && !scheduled.length)
      : view === "files"
        ? loading.files && !files.length
        : view === "threads"
          ? loading.threads && !threads.length
          : loading.activity && !activity.length;
  const loadMore = (kind: CollectionKind, label: string) =>
    pages[kind].hasMore ? (
      <button
        className="secondary"
        disabled={loading[kind]}
        onClick={() => void load(kind, true)}
      >
        {loading[kind] ? "Loading…" : label}
      </button>
    ) : null;
  const title =
    view === "later"
      ? "Later"
      : view === "activity"
        ? "Activity"
        : view === "threads"
          ? "Threads"
          : "Files";
  return (
    <section className="collection-view">
      <header className="conversation-header">
        <h1>
          {view === "later" ? (
            <Bookmark size={22} />
          ) : view === "activity" ? (
            <Bell size={22} />
          ) : view === "threads" ? (
            <MessageCircle size={22} />
          ) : (
            <FileText size={22} />
          )}
          {title}
        </h1>
        <button
          className="secondary small-button"
          onClick={() => {
            reload();
            onRefresh();
          }}
        >
          Refresh
        </button>
      </header>
      <div className="collection-body">
        <div className="collection-intro">
          <div className="eyebrow">YOUR WORK, A LITTLE MORE ORGANIZED</div>
          <h2>
            {view === "later"
              ? "A little space for what’s next."
              : view === "threads"
                ? "Keep the conversation connected."
                : view === "activity"
                  ? "You’re in the loop."
                  : "The things your team shares."}
          </h2>
          <p>
            {view === "later"
              ? "Saved for a quieter moment. Scheduled for the right one."
              : view === "threads"
                ? "The discussions you follow, with room to pick up where you left off."
                : view === "activity"
                  ? "Mentions, messages, and threads that bring you into the conversation."
                  : "Find the documents and images behind the conversation."}
          </p>
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {busy ? (
          <div className="search-loading">
            <LoaderCircle size={23} className="spin" />
            Loading…
          </div>
        ) : (
          <>
            {view === "threads" && (
              <>
                {threads.map((root) => {
                  const summary = threadMetadata[root.id];
                  return (
                    <div className="saved-card" key={root.id}>
                      <button
                        className="saved-context"
                        onClick={() => onAction("thread", root)}
                      >
                        <Hash size={13} />
                        {conversations.find(
                          (c) => c.id === root.conversation_id,
                        )?.name || "Conversation"}
                        {(summary?.unread_count ?? 0) > 0 && (
                          <span className="channel-count">
                            {summary.unread_count} unread
                          </span>
                        )}
                      </button>
                      <MessageCard
                        message={root}
                        userId={profile.id}
                        saved={savedIds.has(root.id)}
                        replyCount={summary?.reply_count ?? 0}
                        onAction={onAction}
                        onReact={async (id, emoji) => {
                          const requestedScope = scope;
                          try {
                            await relay.toggleReaction(id, emoji);
                            const updated = await relay.message(id);
                            if (
                              updated &&
                              currentScope.current === requestedScope
                            )
                              setThreads((rows) =>
                                rows.map((row) =>
                                  row.id === id ? updated : row,
                                ),
                              );
                          } catch (err) {
                            if (currentScope.current === requestedScope)
                              onError(
                                err instanceof Error
                                  ? err.message
                                  : "Could not add reaction.",
                              );
                          }
                        }}
                        onError={onError}
                      />
                      <div
                        className="thread-collection-footer"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "8px 16px 14px",
                          flexWrap: "wrap",
                        }}
                      >
                        <div
                          style={{ display: "flex", gap: 4 }}
                          aria-label="Thread participants"
                        >
                          {summary?.participants.slice(0, 6).map((person) => (
                            <Avatar
                              key={person.id}
                              small
                              name={person.display_name}
                              url={person.avatar_url}
                              avatarPath={person.avatar_path}
                            />
                          ))}
                        </div>
                        <button
                          className="text-link"
                          onClick={() => onAction("thread", root)}
                        >
                          View thread
                          {summary?.last_reply_at
                            ? ` · ${new Date(summary.last_reply_at).toLocaleDateString()}`
                            : ""}
                        </button>
                        <button
                          className="text-link"
                          style={{ marginLeft: "auto" }}
                          onClick={async () => {
                            const requestedScope = scope;
                            try {
                              await relay.followThread(root.id, false);
                              if (currentScope.current !== requestedScope)
                                return;
                              setThreads((rows) =>
                                rows.filter((row) => row.id !== root.id),
                              );
                              onRefresh();
                            } catch (err) {
                              if (currentScope.current === requestedScope)
                                onError(
                                  err instanceof Error
                                    ? err.message
                                    : "Could not unfollow this thread.",
                                );
                            }
                          }}
                        >
                          Unfollow
                        </button>
                      </div>
                    </div>
                  );
                })}
                {loadMore("threads", "Load more threads")}
                {!threads.length && (
                  <Empty
                    icon={<MessageCircle size={30} />}
                    title="A place for the conversations you follow."
                  >
                    Reply to a thread or choose Follow in its panel. You’ll find
                    it here when there’s more to discuss.
                  </Empty>
                )}
              </>
            )}
            {view === "later" && (
              <>
                <h3 className="collection-section-title">
                  <Bookmark size={16} />
                  Saved messages <span>{saved.length}</span>
                </h3>
                {saved.map((s) => (
                  <div className="saved-card" key={s.message_id}>
                    <button
                      className="saved-context"
                      onClick={() =>
                        onNavigate(s.message.conversation_id, s.message_id)
                      }
                    >
                      <Hash size={13} />
                      {conversations.find(
                        (c) => c.id === s.message.conversation_id,
                      )?.name || "Conversation"}
                    </button>
                    <MessageCard
                      message={s.message}
                      userId={profile.id}
                      saved={savedIds.has(s.message_id)}
                      onAction={onAction}
                      onReact={async (id, emoji) => {
                        try {
                          await relay.toggleReaction(id, emoji);
                          const updated = await relay.message(id);
                          if (updated && currentScope.current === scope)
                            setSaved((rows) =>
                              rows.map((row) =>
                                row.message_id === id
                                  ? { ...row, message: updated }
                                  : row,
                              ),
                            );
                        } catch (err) {
                          if (currentScope.current !== scope) return;
                          onError(
                            err instanceof Error
                              ? err.message
                              : "Could not add reaction.",
                          );
                        }
                      }}
                      onError={onError}
                    />
                  </div>
                ))}
                {loadMore("saved", "Load more saved messages")}
                {!saved.length && (
                  <div className="collection-empty">
                    <Bookmark size={22} />
                    <p>Save any message to make room for it here.</p>
                  </div>
                )}
                <h3 className="collection-section-title">
                  <CalendarClock size={16} />
                  Scheduled messages <span>{scheduled.length}</span>
                </h3>
                {scheduled.map((s) => (
                  <div className="scheduled-card" key={s.id}>
                    <CalendarClock size={20} />
                    <div>
                      <strong>
                        {new Date(s.scheduled_at).toLocaleString()}
                      </strong>
                      <p>{s.body}</p>
                      {s.error && (
                        <p role="alert" className="danger-text">
                          {s.error}
                        </p>
                      )}
                    </div>
                    <button
                      className="text-link danger-text"
                      onClick={async () => {
                        try {
                          await relay.cancelScheduled(s.id);
                          if (currentScope.current === scope) {
                            setScheduled((rows) =>
                              rows.filter((row) => row.id !== s.id),
                            );
                            void load("scheduled");
                          }
                        } catch (err) {
                          if (currentScope.current !== scope) return;
                          onError(
                            err instanceof Error
                              ? err.message
                              : "Could not cancel scheduled message.",
                          );
                        }
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ))}
                {loadMore("scheduled", "Load more scheduled messages")}
                {!scheduled.length && (
                  <div className="collection-empty">
                    <CalendarClock size={22} />
                    <p>Messages you schedule will appear here.</p>
                  </div>
                )}
              </>
            )}
            {view === "activity" && (
              <>
                {activity.map((n) => (
                  <button
                    className={`notification-item ${!n.read_at ? "unread" : ""}`}
                    key={n.id}
                    onClick={async () => {
                      try {
                        await relay.markNotificationRead(n.id);
                        if (currentScope.current !== scope) return;
                        requests.current.activity.invalidate();
                        setLoading((value) => ({ ...value, activity: false }));
                        setActivity((rows) =>
                          rows.map((row) =>
                            row.id === n.id
                              ? { ...row, read_at: new Date().toISOString() }
                              : row,
                          ),
                        );
                        onRefresh();
                        onNavigate(n.conversation_id, n.message_id);
                      } catch (err) {
                        if (currentScope.current !== scope) return;
                        onError(
                          err instanceof Error
                            ? err.message
                            : "Could not open notification.",
                        );
                      }
                    }}
                  >
                    <span className="notification-icon">
                      {n.kind === "mention" ? "@" : <MessageCircle size={20} />}
                    </span>
                    <div>
                      <strong>
                        {n.kind === "mention"
                          ? "You were mentioned"
                          : n.kind === "thread"
                            ? "A thread you follow has a reply"
                            : "A new message for you"}
                      </strong>
                      <p>
                        {conversations.find((c) => c.id === n.conversation_id)
                          ?.name || "Conversation"}
                      </p>
                    </div>
                    <time>{new Date(n.created_at).toLocaleString()}</time>
                    {!n.read_at && <span className="unread-dot" />}
                  </button>
                ))}
                {loadMore("activity", "Load older activity")}
                {!activity.length && (
                  <Empty
                    icon={<Check size={30} />}
                    title="All quiet. All caught up."
                  >
                    Your mentions, direct messages, and thread replies will
                    appear here.
                  </Empty>
                )}
              </>
            )}
            {view === "files" && (
              <>
                {files.map((file) => (
                  <button
                    className="file-list-item"
                    key={file.id}
                    onClick={async () => {
                      const requestedScope = currentScope.current;
                      try {
                        const url = await relay.signedAttachmentUrl(file, true);
                        if (currentScope.current !== requestedScope) return;
                        window.open(url, "_blank", "noopener,noreferrer");
                      } catch (err) {
                        if (currentScope.current !== requestedScope) return;
                        onError(
                          err instanceof Error
                            ? err.message
                            : "Could not download file.",
                        );
                      }
                    }}
                  >
                    <FileText size={26} />
                    <span>
                      <strong>{file.name}</strong>
                      <p>
                        {conversations.find(
                          (c) => c.id === file.conversation_id,
                        )?.name || "Conversation"}{" "}
                        · {(file.size / 1024).toFixed(0)} KB
                      </p>
                    </span>
                    <time>
                      {new Date(file.created_at).toLocaleDateString()}
                    </time>
                  </button>
                ))}
                {loadMore("files", "Load more files")}
                {!files.length && (
                  <Empty
                    icon={<FileText size={31} />}
                    title="Ideas travel with attachments."
                  >
                    Share a document or image in a conversation, and you’ll find
                    it here.
                  </Empty>
                )}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}

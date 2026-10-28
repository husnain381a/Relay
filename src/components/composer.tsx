"use client";
import { useEffect, useRef, useState } from "react";
import {
  AtSign,
  Bold,
  CalendarClock,
  Code,
  Eye,
  Hash,
  Italic,
  List,
  Paperclip,
  Send,
  Smile,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { IconButton, Modal } from "./ui";
import type { WorkspaceMember } from "@/lib/types";
import type { Conversation } from "@/lib/types";
import { relay } from "@/lib/relay";
import { RichEditor, type RichEditorHandle } from "./rich-editor";

export const EMOJI = [
  "👍",
  "❤️",
  "🎉",
  "👀",
  "🙌",
  "✅",
  "💡",
  "🚀",
  "😊",
  "🔥",
  "🤔",
  "👏",
  "🙏",
  "💜",
  "💯",
  "☕",
];
export function Composer({
  conversationId,
  userId,
  parentId,
  label,
  members,
  channels = [],
  persistDraft = true,
  disabled,
  onTyping,
  onSend,
}: {
  conversationId: string;
  userId: string;
  parentId?: string;
  label: string;
  members: WorkspaceMember[];
  channels?: Conversation[];
  persistDraft?: boolean;
  disabled?: boolean;
  onTyping?: () => void;
  onSend: (
    body: string,
    files: File[],
    scheduledAt?: string,
    clientId?: string,
  ) => Promise<void>;
}) {
  const key = `relay:draft:${userId}:${conversationId}:${parentId || "main"}`;
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const [mentions, setMentions] = useState(false);
  const [channelPicker, setChannelPicker] = useState(false);
  const [sourceMode, setSourceMode] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [cloudDraft, setCloudDraft] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(!persistDraft);
  const [retrySync, setRetrySync] = useState(0);
  const [schedule, setSchedule] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const rich = useRef<RichEditorHandle>(null);
  const revision = useRef(0);
  const dirty = useRef(false);
  const draftWrites = useRef(Promise.resolve());
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    const local = sessionStorage.getItem(key) || "";
    revision.current = 0;
    dirty.current = !!local;
    setBody(local);
    setFiles([]);
    setError("");
    setCloudDraft(null);
    setDraftError("");
    setDraftReady(!persistDraft);
    if (persistDraft)
      relay
        .draft(conversationId, parentId)
        .then((draft) => {
          if (!active || revision.current !== 0) return;
          if (!local && draft) {
            setBody(draft.body);
            sessionStorage.setItem(key, draft.body);
          } else if (local && draft?.body && draft.body !== local)
            setCloudDraft(draft.body);
        })
        .catch((err) => {
          if (active) setDraftError(err.message);
        })
        .finally(() => {
          if (active) setDraftReady(true);
        });
    return () => {
      active = false;
    };
  }, [key, persistDraft]);
  useEffect(() => {
    if (!persistDraft || !draftReady || !dirty.current) return;
    const generation = revision.current;
    const timer = setTimeout(() => {
      draftWrites.current = draftWrites.current
        .catch(() => {})
        .then(async () => {
          try {
            await relay.saveDraft(conversationId, body, parentId);
            if (revision.current === generation) {
              dirty.current = false;
              setDraftError("");
            }
          } catch (err) {
            if (revision.current === generation)
              setDraftError(
                err instanceof Error ? err.message : "Draft sync failed.",
              );
          }
        });
    }, 750);
    return () => clearTimeout(timer);
  }, [body, draftReady, retrySync, key, persistDraft]);
  const changeBody = (text: string) => {
    revision.current++;
    dirty.current = true;
    setBody(text);
    sessionStorage.setItem(key, text);
    onTyping?.();
  };
  useEffect(() => {
    const sent = (event: Event) => {
      const value = (
        event as CustomEvent<{
          id: string;
          body: string;
          conversationId: string;
          parentId?: string;
        }>
      ).detail;
      if (
        !value ||
        value.conversationId !== conversationId ||
        (value.parentId || null) !== (parentId || null)
      )
        return;
      try {
        const pending = JSON.parse(
          sessionStorage.getItem(`${key}:pending`) || "null",
        );
        if (
          pending?.id !== value.id ||
          (body.trim() || "Shared a file") !== value.body
        )
          return;
        changeBody("");
        setFiles([]);
        sessionStorage.removeItem(`${key}:pending`);
        if (persistDraft)
          draftWrites.current = draftWrites.current
            .catch(() => {})
            .then(() => relay.clearDraft(conversationId, parentId))
            .catch(() =>
              setDraftError(
                "Message sent, but the synced draft could not be cleared.",
              ),
            );
      } catch {
        /* A damaged local retry marker must never remove the current draft. */
      }
    };
    window.addEventListener("relay:message-sent", sent);
    return () => window.removeEventListener("relay:message-sent", sent);
  }, [body, key, persistDraft]);
  const insert = (before: string, after = "") => {
    if (!sourceMode && !preview) {
      rich.current?.insertText(before);
      return;
    }
    const el = textarea.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    changeBody(
      body.slice(0, start) +
        before +
        body.slice(start, end) +
        after +
        body.slice(end),
    );
    el?.focus();
    requestAnimationFrame(() =>
      el?.setSelectionRange(start + before.length, end + before.length),
    );
  };
  const addFiles = (incoming: File[]) => {
    if (incoming.some((f) => f.size > 10 * 1024 * 1024)) {
      setError("Each attachment must be 10 MB or smaller.");
      return;
    }
    if (incoming.length + files.length > 5) {
      setError("Attach up to 5 files per message.");
      return;
    }
    setFiles((f) => [...f, ...incoming]);
  };
  const send = async (date?: string) => {
    if (busy || disabled || (!body.trim() && !files.length)) return;
    if (date && files.length) {
      setError("Send attachments now, or schedule a text message.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const outgoing = body.trim() || "Shared a file";
      let pending: { id: string; body: string } | null = null;
      try {
        pending = JSON.parse(
          sessionStorage.getItem(`${key}:pending`) || "null",
        );
      } catch {
        /* Replace invalid local state. */
      }
      const id =
        pending?.body === outgoing && typeof pending.id === "string"
          ? pending.id
          : crypto.randomUUID();
      if (!date)
        sessionStorage.setItem(
          `${key}:pending`,
          JSON.stringify({ id, body: outgoing }),
        );
      await onSend(outgoing, files, date, id);
      changeBody("");
      setFiles([]);
      setSchedule(false);
      setScheduleAt("");
      setCloudDraft(null);
      sessionStorage.removeItem(`${key}:pending`);
      if (persistDraft) {
        await draftWrites.current.catch(() => {});
        try {
          await relay.clearDraft(conversationId, parentId);
          dirty.current = false;
          setDraftError("");
        } catch {
          setDraftError(
            "Message sent. Could not clear the synced draft; retry sync to remove it.",
          );
        }
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Message failed. Your draft has been kept.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className={`composer-area ${disabled ? "composer-disabled" : ""}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (!disabled) addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="composer">
        <div className="format-bar">
          <IconButton
            label="Bold selected text"
            disabled={disabled || busy}
            onClick={() =>
              sourceMode ? insert("**", "**") : rich.current?.bold()
            }
          >
            <Bold size={16} />
          </IconButton>
          <IconButton
            label="Italic selected text"
            disabled={disabled || busy}
            onClick={() =>
              sourceMode ? insert("_", "_") : rich.current?.italic()
            }
          >
            <Italic size={16} />
          </IconButton>
          <IconButton
            label="Code selected text"
            disabled={disabled || busy}
            onClick={() =>
              sourceMode ? insert("`", "`") : rich.current?.code()
            }
          >
            <Code size={17} />
          </IconButton>
          <span className="toolbar-separator" />
          <IconButton
            label="Insert list"
            disabled={disabled || busy}
            onClick={() => (sourceMode ? insert("\n- ") : rich.current?.list())}
          >
            <List size={17} />
          </IconButton>
          <IconButton
            label="Preview formatting"
            aria-pressed={preview}
            onClick={() => setPreview(!preview)}
          >
            <Eye size={17} />
          </IconButton>
          <button
            className="editor-mode-button"
            type="button"
            aria-pressed={sourceMode}
            onClick={() => {
              setSourceMode(!sourceMode);
              setPreview(false);
            }}
          >
            {sourceMode ? "Visual editor" : "Markdown"}
          </button>
        </div>
        {preview ? (
          <div className="markdown composer-preview">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {body || "*Your preview will appear here.*"}
            </ReactMarkdown>
          </div>
        ) : sourceMode ? (
          <textarea
            ref={textarea}
            value={body}
            disabled={disabled || busy}
            maxLength={12000}
            aria-label={parentId ? "Thread reply" : `Message ${label}`}
            placeholder={
              disabled
                ? "This channel is archived"
                : parentId
                  ? "Reply to this thread…"
                  : `Message ${label}`
            }
            onChange={(e) => changeBody(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void send();
              }
            }}
          />
        ) : (
          <RichEditor
            key={key}
            ref={rich}
            value={body}
            label={parentId ? "Thread reply" : `Message ${label}`}
            placeholder={
              disabled
                ? "This channel is archived"
                : parentId
                  ? "Reply to this thread…"
                  : `Message ${label}`
            }
            disabled={disabled || busy}
            onChange={changeBody}
            onSend={() => void send()}
            onError={setError}
          />
        )}
        {files.length > 0 && (
          <div className="file-chips">
            {files.map((file, i) => (
              <span key={`${file.name}-${i}`}>
                <Paperclip size={13} />
                {file.name}
                <IconButton
                  label={`Remove ${file.name}`}
                  onClick={() => setFiles((f) => f.filter((_, n) => n !== i))}
                >
                  <X size={13} />
                </IconButton>
              </span>
            ))}
          </div>
        )}
        <div className="composer-bottom">
          <input
            ref={fileInput}
            hidden
            type="file"
            multiple
            onChange={(e) => {
              addFiles(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
          <IconButton
            label="Attach files"
            disabled={disabled || busy}
            onClick={() => fileInput.current?.click()}
          >
            <Paperclip size={18} />
          </IconButton>
          <div className="popover-anchor">
            <IconButton
              label="Insert emoji"
              aria-expanded={emoji}
              onClick={() => {
                setEmoji(!emoji);
                setMentions(false);
              }}
            >
              <Smile size={18} />
            </IconButton>
            {emoji && (
              <div className="emoji-popover">
                {EMOJI.map((item) => (
                  <button
                    key={item}
                    aria-label={`Insert ${item}`}
                    onClick={() => {
                      insert(item);
                      setEmoji(false);
                    }}
                  >
                    {item}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="popover-anchor">
            <IconButton
              label="Mention a teammate"
              aria-expanded={mentions}
              onClick={() => {
                setMentions(!mentions);
                setEmoji(false);
              }}
            >
              <AtSign size={18} />
            </IconButton>
            {mentions && (
              <div className="mention-popover">
                {members.map((m) => (
                  <button
                    key={m.user_id}
                    onClick={() => {
                      insert(
                        `@${m.profile?.username || m.profile?.display_name.replaceAll(" ", "")} `,
                      );
                      setMentions(false);
                    }}
                  >
                    {m.profile?.display_name}
                    <span>@{m.profile?.username}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="popover-anchor">
            <IconButton
              label="Mention a channel"
              aria-expanded={channelPicker}
              disabled={disabled || busy}
              onClick={() => {
                setChannelPicker(!channelPicker);
                setMentions(false);
                setEmoji(false);
              }}
            >
              <Hash size={18} />
            </IconButton>
            {channelPicker && (
              <div className="mention-popover">
                {channels
                  .filter((c) => c.kind !== "dm" && !c.archived_at)
                  .map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        const href = `/?workspace=${c.workspace_id}&conversation=${c.id}`;
                        if (!sourceMode && !preview)
                          rich.current?.insertLink(`#${c.name}`, href);
                        else insert(`[#${c.name}](${href}) `);
                        setChannelPicker(false);
                      }}
                    >
                      #{c.name}
                      <span>
                        {c.kind === "private"
                          ? "Private channel"
                          : "Public channel"}
                      </span>
                    </button>
                  ))}
                {!channels.length && (
                  <p className="field-hint">No channels available.</p>
                )}
              </div>
            )}
          </div>
          <span className="composer-spacer" />
          <button
            className="send-button"
            disabled={busy || disabled || (!body.trim() && !files.length)}
            onClick={() => void send()}
            title="Send message (Enter)"
            aria-label="Send message"
          >
            {busy ? <span className="sending-dot" /> : <Send size={17} />}
          </button>
          <IconButton
            label="Schedule this message"
            disabled={busy || disabled || !body.trim()}
            onClick={() => setSchedule(true)}
          >
            <CalendarClock size={16} />
          </IconButton>
        </div>
      </div>
      {cloudDraft !== null && (
        <div className="draft-sync-notice">
          There’s a different draft from another device.
          <button
            onClick={() => {
              changeBody(cloudDraft);
              setCloudDraft(null);
            }}
          >
            Use synced draft
          </button>
          <button onClick={() => setCloudDraft(null)}>Keep this draft</button>
        </div>
      )}
      {draftError && (
        <div className="draft-sync-notice" role="status">
          <span>Draft kept on this device. {draftError}</span>
          <button
            onClick={() => {
              dirty.current = true;
              setRetrySync((n) => n + 1);
            }}
          >
            Retry sync
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="form-error composer-error">
          {error}
        </p>
      )}
      <div className="composer-help">
        <span>
          <strong>Enter</strong> to send · <strong>Shift + Enter</strong> for a
          new line
        </span>
        <span>
          {body.length > 11000
            ? `${body.length}/12000`
            : "A little kindness goes a long way."}
        </span>
      </div>
      <Modal
        title="Send at just the right time"
        description="Scheduled messages use the workspace’s configured background dispatcher."
        open={schedule}
        onClose={() => setSchedule(false)}
      >
        <label className="field">
          <span>Send on</span>
          <input
            type="datetime-local"
            value={scheduleAt}
            onChange={(e) => setScheduleAt(e.target.value)}
            min={new Date(
              Date.now() + 60000 - new Date().getTimezoneOffset() * 60000,
            )
              .toISOString()
              .slice(0, 16)}
            required
          />
        </label>
        <button
          className="primary"
          disabled={!scheduleAt || busy}
          onClick={() => void send(new Date(scheduleAt).toISOString())}
        >
          Schedule message
        </button>
      </Modal>
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import {
  Bookmark,
  Check,
  Copy,
  Download,
  FileText,
  Forward,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  RotateCcw,
  SmilePlus,
  Trash2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Attachment, Message, ThreadSummary } from "@/lib/types";
import { groupReactions } from "@/lib/messages";
import { relay } from "@/lib/relay";
import { Avatar, IconButton } from "./ui";
import { EMOJI } from "./composer";

export type MessageAction =
  "thread" | "save" | "pin" | "edit" | "delete" | "retry" | "copy" | "forward";
function AttachedFile({
  file,
  onError,
}: {
  file: Attachment;
  onError: (error: string) => void;
}) {
  const [url, setUrl] = useState("");
  const image = /^image\/(png|jpeg|gif|webp)$/.test(file.mime_type);
  useEffect(() => {
    if (!image) return;
    let active = true;
    relay
      .signedAttachmentUrl(file)
      .then((signed) => {
        if (active) setUrl(signed);
      })
      .catch((err) => {
        if (active) onError(err.message);
      });
    return () => {
      active = false;
    };
  }, [file.id, image]);
  return (
    <div className="attachment">
      {image && url && (
        <a href={url} target="_blank" rel="noopener noreferrer">
          <img
            className="message-image"
            src={url}
            alt={file.name}
            loading="lazy"
          />
        </a>
      )}
      <button
        onClick={async () => {
          try {
            const signed = await relay.signedAttachmentUrl(file, true);
            const a = document.createElement("a");
            a.href = signed;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            a.click();
          } catch (err) {
            onError(
              err instanceof Error
                ? err.message
                : "Could not download this file.",
            );
          }
        }}
      >
        <span className="file-icon">
          <FileText size={21} />
        </span>
        <span>
          <strong>{file.name}</strong>
          <small>
            {(file.size / 1024).toFixed(0)} KB ·{" "}
            {file.mime_type.split("/")[1]?.toUpperCase() || "FILE"}
          </small>
        </span>
        <Download size={16} />
      </button>
    </div>
  );
}
export function MessageCard({
  message,
  userId,
  replyCount = 0,
  threadSummary,
  saved = false,
  pinned = false,
  online = false,
  compact = false,
  onAction,
  onReact,
  onError,
}: {
  message: Message;
  userId: string;
  replyCount?: number;
  threadSummary?: ThreadSummary;
  saved?: boolean;
  pinned?: boolean;
  online?: boolean;
  compact?: boolean;
  onAction: (action: MessageAction, message: Message) => void;
  onReact: (id: string, emoji: string) => void;
  onError: (error: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const name = message.author?.display_name || "Former teammate";
  return (
    <article
      id={`message-${message.id}`}
      className={`message-row ${compact ? "compact" : ""} ${message.delivery === "failed" ? "failed" : ""} ${message.delivery === "sending" ? "pending" : ""}`}
    >
      {!compact ? (
        <Avatar
          name={name}
          url={message.author?.avatar_url}
          avatarPath={message.author?.avatar_path}
          online={online}
        />
      ) : (
        <span className="compact-time">
          {new Date(message.created_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      )}
      <div className="message-content">
        {!compact && (
          <div className="message-meta">
            <strong>{name}</strong>
            {message.author_id === userId && (
              <span className="you-label">you</span>
            )}
            <time
              dateTime={message.created_at}
              title={new Date(message.created_at).toLocaleString()}
            >
              {new Date(message.created_at).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </time>
            {pinned && (
              <span className="pin-label">
                <Pin size={11} /> Pinned
              </span>
            )}
          </div>
        )}
        {message.deleted_at ? (
          <p className="deleted-message">This message was deleted.</p>
        ) : (
          <>
            <div className="markdown">
              <ReactMarkdown
                skipHtml
                remarkPlugins={[remarkGfm]}
                components={{
                  a: (props) =>
                    props.href?.startsWith("/?workspace=") ? (
                      <a
                        {...props}
                        onClick={(event) => {
                          event.preventDefault();
                          window.dispatchEvent(
                            new CustomEvent("relay:navigate", {
                              detail: props.href,
                            }),
                          );
                        }}
                      />
                    ) : (
                      <a {...props} target="_blank" rel="noopener noreferrer" />
                    ),
                  img: ({ alt }) => (
                    <span className="muted">
                      [External image: {alt || "image"}]
                    </span>
                  ),
                }}
              >
                {message.body}
              </ReactMarkdown>
              {message.edited_at && (
                <span className="edited-label">(edited)</span>
              )}
            </div>
            {message.attachments?.map((file) => (
              <AttachedFile key={file.id} file={file} onError={onError} />
            ))}
            <div className="reaction-row">
              {groupReactions(message.reactions || [], userId).map(
                (reaction) => (
                  <button
                    className={`reaction ${reaction.mine ? "mine" : ""}`}
                    key={reaction.emoji}
                    aria-label={`${reaction.emoji}, ${reaction.count} reaction${reaction.count > 1 ? "s" : ""}`}
                    aria-pressed={reaction.mine}
                    onClick={() => onReact(message.id, reaction.emoji)}
                  >
                    <span>{reaction.emoji}</span>
                    {reaction.count}
                  </button>
                ),
              )}
              {(message.reactions?.length || 0) > 0 && (
                <IconButton
                  label="Add another reaction"
                  onClick={() => setEmoji(!emoji)}
                >
                  <SmilePlus size={15} />
                </IconButton>
              )}
            </div>
          </>
        )}
        {replyCount > 0 && !message.parent_id && (
          <button
            className="thread-link"
            onClick={() => onAction("thread", message)}
          >
            {threadSummary?.participants && (
              <span
                className="thread-participants"
                aria-label={`${threadSummary.participants.length} thread participants`}
              >
                {threadSummary.participants.slice(0, 3).map((p) => (
                  <Avatar
                    key={p.id}
                    small
                    name={p.display_name}
                    url={p.avatar_url}
                    avatarPath={p.avatar_path}
                  />
                ))}
              </span>
            )}
            <MessageSquare size={14} />
            <strong>
              {replyCount} {replyCount === 1 ? "reply" : "replies"}
            </strong>
            {threadSummary && threadSummary.unread_count > 0 ? (
              <span className="thread-unread">
                {threadSummary.unread_count} unread
              </span>
            ) : (
              <span>View thread</span>
            )}
          </button>
        )}
        {message.delivery === "sending" && (
          <span className="delivery-status">Sending…</span>
        )}
        {message.delivery === "failed" && (
          <div className="delivery-error">
            {message.error || "Couldn’t send this message."}
            <button onClick={() => onAction("retry", message)}>
              <RotateCcw size={12} />
              Retry
            </button>
          </div>
        )}
      </div>
      {!message.deleted_at &&
        message.delivery !== "sending" &&
        message.delivery !== "failed" && (
          <div className="message-actions">
            <IconButton
              label="React to message"
              onClick={() => {
                setEmoji(!emoji);
                setMenu(false);
              }}
            >
              <SmilePlus size={16} />
            </IconButton>
            {!message.parent_id && (
              <IconButton
                label="Reply in thread"
                onClick={() => onAction("thread", message)}
              >
                <MessageSquare size={16} />
              </IconButton>
            )}
            <IconButton
              label={saved ? "Remove from Later" : "Save for later"}
              aria-pressed={saved}
              onClick={() => onAction("save", message)}
            >
              {saved ? <Check size={16} /> : <Bookmark size={16} />}
            </IconButton>
            <IconButton
              label="More message actions"
              aria-expanded={menu}
              onClick={() => {
                setMenu(!menu);
                setEmoji(false);
              }}
            >
              <MoreHorizontal size={17} />
            </IconButton>
          </div>
        )}
      {emoji && (
        <div className="message-emoji">
          <button className="popover-close" onClick={() => setEmoji(false)}>
            Close
          </button>
          <div className="emoji-grid">
            {EMOJI.map((item) => (
              <button
                key={item}
                aria-label={`React ${item}`}
                onClick={() => {
                  onReact(message.id, item);
                  setEmoji(false);
                }}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      )}
      {menu && (
        <div
          className="message-menu"
          onKeyDown={(e) => {
            if (e.key === "Escape") setMenu(false);
          }}
        >
          <button
            onClick={() => {
              onAction("copy", message);
              setMenu(false);
            }}
          >
            <Copy size={15} />
            Copy message link
          </button>
          <button
            onClick={() => {
              onAction("forward", message);
              setMenu(false);
            }}
          >
            <Forward size={15} />
            Forward message
          </button>
          <button
            onClick={() => {
              onAction("pin", message);
              setMenu(false);
            }}
          >
            <Pin size={15} />
            {pinned ? "Unpin message" : "Pin to conversation"}
          </button>
          {message.author_id === userId && (
            <>
              <button
                onClick={() => {
                  onAction("edit", message);
                  setMenu(false);
                }}
              >
                <Pencil size={15} />
                Edit message
              </button>
              <button
                className="danger-text"
                onClick={() => {
                  onAction("delete", message);
                  setMenu(false);
                }}
              >
                <Trash2 size={15} />
                Delete message
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
}

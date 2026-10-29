"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { X, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { PrivateMediaImage } from "./media-settings";

export function IconButton({
  label,
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`icon-button ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
export function Modal({
  title,
  description,
  open,
  onClose,
  children,
  wide = false,
  onCloseAutoFocus,
}: {
  title: string;
  description?: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className={`modal ${wide ? "wide" : ""}`}
          aria-describedby={description ? undefined : undefined}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <div className="modal-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label="Close dialog">
                <X size={19} />
              </IconButton>
            </Dialog.Close>
          </div>
          {description ? (
            <Dialog.Description>{description}</Dialog.Description>
          ) : (
            <Dialog.Description className="sr-only">
              {title} options
            </Dialog.Description>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Avatar({
  name,
  url,
  avatarPath,
  small = false,
  online = false,
}: {
  name?: string;
  url?: string | null;
  avatarPath?: string | null;
  small?: boolean;
  online?: boolean;
}) {
  const initials = (name || "?")
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const palette = ["lavender", "sage", "peach", "blue"];
  const color =
    palette[
      (name || "").split("").reduce((a, c) => a + c.charCodeAt(0), 0) %
        palette.length
    ];
  return (
    <span className={`avatar ${color} ${small ? "small" : ""}`}>
      {avatarPath ? (
        <PrivateMediaImage
          path={avatarPath}
          alt={name || "Profile"}
          fallback={initials}
        />
      ) : url ? (
        <img src={url} alt={name || "Profile"} />
      ) : (
        initials
      )}
      {online && <span className="presence-dot" />}
    </span>
  );
}
export function TaskForm({
  children,
  submit,
  label = "Save changes",
  onDone,
}: {
  children: React.ReactNode;
  submit: (form: FormData) => Promise<unknown>;
  label?: string;
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="task-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        try {
          await submit(new FormData(e.currentTarget));
          onDone?.();
        } catch (err) {
          setError(
            err instanceof Error
              ? err.message
              : "Something went wrong. Please try again.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <button className="primary" disabled={busy}>
        {busy ? <LoaderCircle size={17} className="spin" /> : null}
        {busy ? "Working…" : label}
      </button>
    </form>
  );
}
export function Field({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input {...props} />
    </label>
  );
}
export function Empty({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}

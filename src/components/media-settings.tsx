"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ImagePlus, LoaderCircle, Trash2, UserRound, Building2, X } from "lucide-react";
import type { Profile, Workspace } from "@/lib/types";
import { getBrowserClient } from "@/lib/supabase/browser";
import { clearProfileMediaCache, createProfileMedia, parseProfileMediaPath, prepareProfileImage, PROFILE_IMAGE_ACCEPT, signedProfileMediaUrl, type SignedProfileMedia } from "@/lib/profile-media";

/** Keep expiring private URLs local to mounted images, never in profile records. */
export function useSignedProfileMedia(path: string | null | undefined) {
  const [value, setValue] = useState<SignedProfileMedia & { path: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const retried = useRef(false);
  useEffect(() => {
    setValue(null); setError(null);
    if (!path || !parseProfileMediaPath(path)) return;
    let disposed = false; let request = 0; let timer: ReturnType<typeof setTimeout> | undefined;
    const client = getBrowserClient();
    async function refresh(force = false) {
      if (disposed || document.visibilityState !== "visible") return;
      const current = ++request;
      try {
        const result = await signedProfileMediaUrl(path!, { client, force });
        if (disposed || current !== request) return;
        setValue({ ...result, path: path! }); setError(null);
        clearTimeout(timer);
        timer = setTimeout(() => void refresh(), Math.max(1000, result.expiresAt - Date.now() - 15000));
      } catch (err) {
        if (disposed || current !== request) return;
        setValue(null); setError(err instanceof Error ? err.message : "This image is unavailable.");
      }
    }
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", visible);
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (!["SIGNED_IN", "SIGNED_OUT", "TOKEN_REFRESHED", "USER_UPDATED"].includes(event)) return;
      clearProfileMediaCache(client); ++request; clearTimeout(timer);
      setValue(null);
      // Avoid asynchronous client calls inside Supabase's auth event lock.
      if (session?.user) timer = setTimeout(() => void refresh(true), 0);
    });
    void refresh(retried.current);
    retried.current = false;
    return () => { disposed = true; ++request; clearTimeout(timer); subscription.unsubscribe(); document.removeEventListener("visibilitychange", visible); };
  }, [path, revision]);
  return {
    url: value && value.path === path && value.expiresAt > Date.now() ? value.url : null,
    error,
    retry: () => { retried.current = true; setRevision(value => value + 1); },
  };
}

export function PrivateMediaImage({ path, alt, fallback = null, className = "" }: { path: string | null | undefined; alt: string; fallback?: ReactNode; className?: string }) {
  const { url, error, retry } = useSignedProfileMedia(path);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const attempted = useRef<string | null>(null);
  if (!url || failedUrl === url) return <span className={className} role="img" aria-label={alt} title={error ? "Image unavailable" : undefined}>{fallback}</span>;
  return <img src={url} alt={alt} className={className} loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover" }} onLoad={() => { attempted.current = null; }} onError={() => { setFailedUrl(url); if (attempted.current !== path) { attempted.current = path || null; retry(); } }} />;
}

type ImageSettingsCommon = { onUpdated: () => void | Promise<void>; onError: (message: string) => void };
export function ProfileImageSettings({ profile, ...callbacks }: ImageSettingsCommon & { profile: Profile }) {
  return <ImageSettings key={`profile:${profile.id}`} kind="avatar" ownerId={profile.id} name={profile.display_name} path={profile.avatar_path} legacyUrl={profile.avatar_url} {...callbacks} />;
}
export function WorkspaceImageSettings({ workspace, ...callbacks }: ImageSettingsCommon & { workspace: Workspace }) {
  return <ImageSettings key={`workspace:${workspace.id}`} kind="workspace" ownerId={workspace.id} name={workspace.name} path={workspace.logo_path} {...callbacks} />;
}

function ImageSettings({ kind, ownerId, name, path, legacyUrl, onUpdated, onError }: ImageSettingsCommon & { kind: "avatar" | "workspace"; ownerId: string; name: string; path?: string | null; legacyUrl?: string | null }) {
  const titleId = useId(); const hintId = useId(); const errorId = useId();
  const input = useRef<HTMLInputElement>(null);
  const errorElement = useRef<HTMLParagraphElement>(null);
  const selection = useRef(0);
  const mounted = useRef(true);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const imageName = kind === "avatar" ? "profile photo" : "workspace logo";
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++selection.current; }; }, []);
  useEffect(() => { if (!file) { setPreview(null); return; } const url = URL.createObjectURL(file); setPreview(url); return () => URL.revokeObjectURL(url); }, [file]);
  function report(value: unknown) {
    const text = value instanceof Error ? value.message : `The ${imageName} could not be changed. Try again.`;
    if (!mounted.current) return;
    setError(text); setStatus(""); onError(text);
    requestAnimationFrame(() => errorElement.current?.focus());
  }
  async function choose(selected: File) {
    const current = ++selection.current;
    setError(""); setStatus(""); setPreparing(true); setFile(null);
    try {
      const prepared = await prepareProfileImage(selected);
      if (mounted.current && current === selection.current) { setFile(prepared); setStatus("Image ready. Save to update your team’s view."); }
    } catch (err) { if (current === selection.current) report(err); }
    finally { if (mounted.current && current === selection.current) setPreparing(false); }
  }
  async function save(remove = false) {
    if (busy || preparing || !remove && !file) return;
    setBusy(true); setError(""); setStatus("");
    try {
      const media = createProfileMedia(getBrowserClient());
      const result = kind === "avatar"
        ? remove ? await media.removeAvatar(ownerId) : await media.uploadAvatar(file!, ownerId)
        : remove ? await media.removeWorkspaceLogo(ownerId) : await media.uploadWorkspaceLogo(ownerId, file!);
      clearProfileMediaCache(getBrowserClient());
      if (mounted.current) { setFile(null); setStatus(remove ? "Image removed." : "Image updated."); if (result.warning) { setError(result.warning); onError(result.warning); } }
      try { await onUpdated(); } catch { report(new Error("Your image was saved, but the screen could not refresh. Reload Relay to see the update.")); }
    } catch (err) { report(err); }
    finally { if (mounted.current) setBusy(false); }
  }
  const FallbackIcon = kind === "avatar" ? UserRound : Building2;
  const unavailable = busy || preparing;
  return <section className="media-settings" aria-labelledby={titleId} aria-busy={unavailable}>
    <h4 id={titleId}>{kind === "avatar" ? "Profile photo" : "Workspace logo"}</h4>
    <div className="media-settings-row" style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
      <div className="media-preview" style={{ width: 72, height: 72, borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", overflow: "hidden", display: "grid", placeItems: "center", flexShrink: 0 }}>
        {preview ? <img src={preview} alt={`Selected ${imageName} preview`} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : path ? <PrivateMediaImage path={path} alt={`${name} ${imageName}`} fallback={<FallbackIcon size={28} aria-hidden="true" />} /> : legacyUrl ? <img src={legacyUrl} alt={`${name} profile photo`} referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <FallbackIcon size={28} aria-hidden="true" />}
      </div>
      <div className="media-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input ref={input} type="file" accept={PROFILE_IMAGE_ACCEPT} hidden aria-label={`Choose ${imageName}`} onChange={event => { const chosen = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (chosen) void choose(chosen); }} disabled={unavailable} />
        <button type="button" className="secondary" onClick={() => input.current?.click()} disabled={unavailable} aria-describedby={`${hintId}${error ? ` ${errorId}` : ""}`}><ImagePlus size={16} aria-hidden="true" />Choose image</button>
        {file && <><button type="button" className="primary" onClick={() => void save()} disabled={unavailable}>{busy ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : null}Save {kind === "avatar" ? "photo" : "logo"}</button><button type="button" className="secondary" disabled={unavailable} onClick={() => { ++selection.current; setFile(null); setError(""); setStatus(""); }}><X size={16} aria-hidden="true" />Cancel</button></>}
        {!file && (path || legacyUrl) && <button type="button" className="secondary" disabled={unavailable} onClick={() => void save(true)}><Trash2 size={16} aria-hidden="true" />Remove image</button>}
      </div>
    </div>
    <p id={hintId} className="field-hint">JPEG, PNG, or WebP. Maximum 2 MiB and 4096 × 4096 pixels. Images are resized to 512 pixels and saved privately.</p>
    <p className="field-hint" role="status" aria-live="polite" style={{ minHeight: "1.4em" }}>{preparing ? "Preparing image…" : busy ? "Saving image…" : status}</p>
    <p id={errorId} ref={errorElement} className="form-error" role="alert" tabIndex={-1} hidden={!error}>{error}</p>
  </section>;
}

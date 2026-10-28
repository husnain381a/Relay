"use client";

import { useEffect, useState } from "react";
import { ProfileImageSettings } from "@/components/media-settings";
import { prepareProfileImage } from "@/lib/profile-media";
import type { Profile } from "@/lib/types";

export interface PreparedMediaInspection { width: number; height: number; type: string; size: number }
declare global {
  interface Window {
    relayMediaHarness?: { inspect: (file: File) => Promise<PreparedMediaInspection> };
  }
}
const profile: Profile = {
  id: "10000000-0000-4000-8000-000000000002",
  display_name: "Test Writer",
  username: "test_writer",
  avatar_url: null,
  avatar_path: null,
  status: "",
  status_emoji: "",
  title: "",
  bio: "",
  dnd_until: null,
};

/** Development-only real browser processing. No backend is mocked or invoked. */
export function MediaHarness() {
  const [lastError, setLastError] = useState("");
  const [blockedSave, setBlockedSave] = useState(false);
  useEffect(() => {
    window.relayMediaHarness = {
      async inspect(file) {
        const prepared = await prepareProfileImage(file);
        const decoded = await createImageBitmap(prepared);
        try { return { width: decoded.width, height: decoded.height, type: prepared.type, size: prepared.size }; }
        finally { decoded.close(); }
      },
    };
    return () => { delete window.relayMediaHarness; };
  }, []);
  return <main style={{ maxWidth: 760, padding: 24, margin: "0 auto", overflowWrap: "anywhere" }}>
    <h1>Isolated image preparation fixture</h1>
    <p>This explicitly enabled development route tests local decoding, resizing, validation, preview and cancellation. Saving to a backend is blocked here.</p>
    <div onClickCapture={event => {
      const element = event.target instanceof Element ? event.target.closest("button") : null;
      if (element?.textContent?.trim() === "Save photo" || element?.textContent?.trim() === "Remove image") {
        event.preventDefault(); event.stopPropagation(); setBlockedSave(true);
      }
    }}>
      <ProfileImageSettings profile={profile} onUpdated={() => {}} onError={setLastError} />
    </div>
    <output data-testid="media-last-error">{lastError}</output>
    {blockedSave && <p role="status">Backend saving is intentionally unavailable in this fixture.</p>}
  </main>;
}

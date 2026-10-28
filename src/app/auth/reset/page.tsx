"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { updatePassword } from "@/lib/auth";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await updatePassword(password);
      setDone(true);
    } catch (value) {
      setError(
        value instanceof Error
          ? value.message
          : "Your password could not be updated. Request a new recovery link.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "var(--background, #f8f8fa)",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 420,
          padding: 32,
          border: "1px solid var(--border, #ddd)",
          borderRadius: 12,
          background: "var(--surface, white)",
        }}
      >
        <p style={{ fontWeight: 700, letterSpacing: "-.03em", fontSize: 22 }}>
          Relay
        </p>
        <h1 style={{ fontSize: 24, marginTop: 24, fontWeight: 650 }}>
          Set a new password
        </h1>
        {done ? (
          <>
            <p style={{ marginBlock: 20 }} role="status">
              Your password has been updated.
            </p>
            <Link href="/">Return to your workspace →</Link>
          </>
        ) : (
          <>
            <p
              style={{
                marginBlock: 16,
                color: "var(--muted-foreground, #555)",
              }}
            >
              Open this page from your recovery email, then choose a password
              with at least 12 characters.
            </p>
            <form onSubmit={submit} style={{ display: "grid", gap: 16 }}>
              <label style={{ display: "grid", gap: 6 }}>
                New password
                <input
                  required
                  type="password"
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  style={{
                    padding: 12,
                    border: "1px solid #aaa",
                    borderRadius: 6,
                  }}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                Confirm password
                <input
                  required
                  type="password"
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  style={{
                    padding: 12,
                    border: "1px solid #aaa",
                    borderRadius: 6,
                  }}
                />
              </label>
              {error && (
                <p role="alert" style={{ color: "#b91c1c", fontSize: 14 }}>
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={busy}
                style={{
                  padding: 12,
                  color: "#fff",
                  background: "#4338ca",
                  border: 0,
                  borderRadius: 6,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {busy ? "Updating…" : "Update password"}
              </button>
            </form>
            <p style={{ marginTop: 20 }}>
              <Link href="/">← Back to Relay</Link>
            </p>
          </>
        )}
      </section>
    </main>
  );
}

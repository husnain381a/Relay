"use client";
import { useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  Hash,
  LockKeyhole,
  MessagesSquare,
  Settings2,
  Sparkles,
} from "lucide-react";
import { signIn, signUp, requestPasswordReset } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { Field, TaskForm } from "./ui";
import { InstallAppButton } from "./pwa-support";

export function AuthScreen() {
  const [mode, setMode] = useState<"signin" | "signup" | "reset">("signin");
  const [notice, setNotice] = useState("");
  const configured = isSupabaseConfigured();
  return (
    <main className="auth-page">
      <div className="auth-install">
        <InstallAppButton />
      </div>
      <a className="auth-brand" href="/">
        <span className="brand-mark">
          r<span />
        </span>
        relay<span className="brand-dot">.</span>
      </a>
      <section className="auth-story">
        <div className="eyebrow">
          <span className="live-dot" /> WORK, WITH A LITTLE MORE CONNECTION
        </div>
        <h1>
          Good work starts
          <br />
          with a conversation<span>.</span>
        </h1>
        <p>
          Your people. Your projects. Your next big idea.
          <br />A thoughtful place to bring it all together.
        </p>
        <div className="connection-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="art-node node-one">
            <Hash size={28} />
          </div>
          <div className="art-node node-two">
            <MessagesSquare size={27} />
          </div>
          <div className="art-node node-three">
            <Sparkles size={24} />
          </div>
          <div className="art-center">
            <span className="brand-mark">
              r<span />
            </span>
          </div>
          <div className="art-label label-one">A place for every project</div>
          <div className="art-label label-two">Room for every idea</div>
          <div className="art-label label-three">
            <span className="live-dot" /> Better, together.
          </div>
        </div>
        <div className="auth-values">
          <span>
            <Check size={15} /> Conversations in context
          </span>
          <span>
            <Check size={15} /> Your team, in sync
          </span>
          <span>
            <LockKeyhole size={14} /> Private by design
          </span>
        </div>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form-inner">
          <div className="eyebrow">A LITTLE CLOSER, EVEN FROM AFAR</div>
          <h2>
            {mode === "signup"
              ? "Make room for your team."
              : mode === "reset"
                ? "Let’s get you back in."
                : "Welcome to your workspace."}
          </h2>
          <p className="muted">
            {mode === "signup"
              ? "Create your account. Your best work is ahead."
              : mode === "reset"
                ? "We’ll email you a secure password reset link."
                : "Sign in and pick up the conversation."}
          </p>
          {!configured ? (
            <div className="setup-panel">
              <Settings2 size={22} />
              <h3>Your space is almost ready.</h3>
              <p>
                Connect a dedicated Supabase project to enable secure accounts
                and real team conversations.
              </p>
              <ol>
                <li>
                  Apply the migrations in <code>supabase/migrations</code>.
                </li>
                <li>
                  Add your project URL and publishable key to{" "}
                  <code>.env.local</code>.
                </li>
                <li>Restart the application and create your account.</li>
              </ol>
              <p className="setup-note">
                Setup instructions are included in the project README. No sample
                accounts or messages are loaded.
              </p>
            </div>
          ) : (
            <>
              {notice && (
                <div className="notice" role="status">
                  {notice}
                </div>
              )}
              <TaskForm
                key={mode}
                label={
                  mode === "signup"
                    ? "Create your account"
                    : mode === "reset"
                      ? "Send reset link"
                      : "Sign in to Relay"
                }
                submit={async (f) => {
                  setNotice("");
                  const email = String(f.get("email"));
                  if (mode === "signin")
                    await signIn(email, String(f.get("password")));
                  else if (mode === "signup") {
                    const result = await signUp(
                      email,
                      String(f.get("password")),
                      String(f.get("name")),
                    );
                    if (!result.session)
                      setNotice(
                        "Check your email to confirm your account, then sign in.",
                      );
                  } else {
                    await requestPasswordReset(email);
                    setNotice(
                      "If this account exists, a reset link is on its way.",
                    );
                  }
                }}
              >
                {mode === "signup" && (
                  <Field
                    label="Your name"
                    name="name"
                    placeholder="What should we call you?"
                    required
                    autoComplete="name"
                    maxLength={80}
                  />
                )}
                <Field
                  label="Work email"
                  name="email"
                  type="email"
                  placeholder="you@yourcompany.com"
                  required
                  autoComplete="email"
                />
                {mode !== "reset" && (
                  <Field
                    label="Password"
                    name="password"
                    type="password"
                    placeholder={
                      mode === "signup"
                        ? "At least 12 characters"
                        : "Your password"
                    }
                    minLength={mode === "signup" ? 12 : 1}
                    required
                    autoComplete={
                      mode === "signup" ? "new-password" : "current-password"
                    }
                  />
                )}
              </TaskForm>
              {mode === "signin" && (
                <button
                  className="text-link forgot"
                  onClick={() => {
                    setMode("reset");
                    setNotice("");
                  }}
                >
                  Forgot your password?
                  <ArrowUpRight size={13} />
                </button>
              )}
              <div className="auth-switch">
                {mode === "signin"
                  ? "New around here?"
                  : "Already have an account?"}{" "}
                <button
                  className="text-link"
                  onClick={() => {
                    setMode(mode === "signin" ? "signup" : "signin");
                    setNotice("");
                  }}
                >
                  {mode === "signin" ? "Create an account" : "Sign in"}
                  <ArrowRight size={14} />
                </button>
              </div>
            </>
          )}
          <div className="auth-footnote">
            <LockKeyhole size={13} /> Your conversations deserve a secure home.
          </div>
        </div>
      </section>
      <footer className="auth-footer">
        <span>Made for the way teams actually work.</span>
        <span>Relay · Team communication, considered.</span>
      </footer>
    </main>
  );
}

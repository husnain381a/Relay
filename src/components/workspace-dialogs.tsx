"use client";
import { useEffect, useState } from "react";
import {
  Bell,
  Check,
  Copy,
  Hash,
  Laptop,
  LockKeyhole,
  LogOut,
  Monitor,
  Moon,
  ShieldCheck,
  Sun,
  User,
  Users,
} from "lucide-react";
import type {
  AuditLog,
  Conversation,
  Profile,
  Workspace,
  WorkspaceMember,
} from "@/lib/types";
import { relay } from "@/lib/relay";
import { signOut, requestPasswordReset } from "@/lib/auth";
import { getBrowserClient } from "@/lib/supabase/browser";
import { Avatar, Field, Modal, TaskForm } from "./ui";
import { ProfileImageSettings, WorkspaceImageSettings } from "./media-settings";

export type DialogType =
  | "workspace"
  | "channel"
  | "dm"
  | "invite"
  | "join"
  | "settings"
  | "details"
  | "shortcuts"
  | null;
export function WorkspaceDialogs({
  dialog,
  close,
  workspace,
  conversation,
  profile,
  members,
  onDone,
  onWorkspace,
  onConversation,
  theme,
  setTheme,
  onError,
}: {
  dialog: DialogType;
  close: () => void;
  workspace?: Workspace;
  conversation?: Conversation;
  profile: Profile;
  members: WorkspaceMember[];
  onDone: () => Promise<void>;
  onWorkspace: (w: Workspace) => void;
  onConversation: (c: Conversation) => void;
  theme: string;
  setTheme: (t: string) => void;
  onError: (s: string) => void;
}) {
  const [invite, setInvite] = useState("");
  const [copied, setCopied] = useState(false);
  const [kind, setKind] = useState<"public" | "private">("public");
  const [selected, setSelected] = useState<string[]>([]);
  const [settingsTab, setSettingsTab] = useState("profile");
  const [participants, setParticipants] = useState<string[]>([]);
  const [launch, setLaunch] = useState(false);
  const [detailTab, setDetailTab] = useState("about");
  const [audit, setAudit] = useState<AuditLog[]>([]);
  const [invitations, setInvitations] = useState<
    { id: string; expires_at: string; uses: number; max_uses: number }[]
  >([]);
  useEffect(() => {
    if (!workspace || dialog !== "settings") return;
    if (settingsTab === "audit")
      relay
        .auditLogs(workspace.id)
        .then(setAudit)
        .catch((e) => onError(e.message));
    if (settingsTab === "invitations")
      getBrowserClient()
        .from("invitations")
        .select("id,expires_at,uses,max_uses")
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: false })
        .then(({ data, error }) => {
          if (error) onError(error.message);
          else setInvitations(data || []);
        });
  }, [dialog, settingsTab, workspace?.id]);
  useEffect(() => {
    const bridge = (
      window as unknown as {
        relayDesktop?: {
          getPreferences(): Promise<{ launchAtStartup: boolean }>;
        };
      }
    ).relayDesktop;
    if (dialog === "settings" && bridge)
      bridge
        .getPreferences()
        .then((p) => setLaunch(p.launchAtStartup))
        .catch((e) => onError(e.message));
  }, [dialog]);
  const role = members.find((m) => m.user_id === profile.id)?.role;
  const admin = role === "owner" || role === "admin";
  useEffect(() => {
    setInvite("");
    setCopied(false);
    setSelected([]);
    setKind("public");
    setDetailTab("about");
    if (dialog === "details" && conversation)
      relay
        .conversationMembers(conversation.id)
        .then((rows) => setParticipants(rows.map((r) => r.user_id)))
        .catch((e) => onError(e.message));
  }, [dialog, conversation?.id]);
  const done = async () => {
    await onDone();
    close();
  };
  const checklist = (
    <div className="member-checklist">
      {members
        .filter((m) => m.user_id !== profile.id)
        .map((m) => (
          <label key={m.user_id}>
            <input
              type="checkbox"
              checked={selected.includes(m.user_id)}
              onChange={(e) =>
                setSelected((s) =>
                  e.target.checked
                    ? [...s, m.user_id]
                    : s.filter((id) => id !== m.user_id),
                )
              }
            />
            <Avatar
              small
              name={m.profile?.display_name}
              url={m.profile?.avatar_url}
              avatarPath={m.profile?.avatar_path}
            />
            <span>
              {m.profile?.display_name}
              <small>@{m.profile?.username}</small>
            </span>
          </label>
        ))}
      {members.length < 2 && (
        <p className="muted">Invite a teammate to start a conversation.</p>
      )}
    </div>
  );
  return (
    <>
      <Modal
        title="A fresh space for your team"
        description="Create a workspace for the people you work with."
        open={dialog === "workspace"}
        onClose={close}
      >
        <TaskForm
          label="Create workspace"
          submit={async (f) => {
            const w = await relay.createWorkspace(String(f.get("name")));
            onWorkspace(w);
            await done();
          }}
        >
          <Field
            label="Workspace name"
            name="name"
            required
            minLength={2}
            maxLength={80}
            placeholder="e.g. your team or company"
          />
          <p className="field-hint">
            You’ll be the workspace owner. Invite teammates once you’re in.
          </p>
        </TaskForm>
      </Modal>
      <Modal
        title={dialog === "dm" ? "Start a conversation" : "Create a channel"}
        description={
          dialog === "dm"
            ? "Choose one teammate or bring a few people together."
            : "Give your project, team, or shared interest a home."
        }
        open={dialog === "channel" || dialog === "dm"}
        onClose={close}
      >
        <TaskForm
          label={dialog === "dm" ? "Start conversation" : "Create channel"}
          submit={async (f) => {
            if (!workspace) throw new Error("Choose a workspace first.");
            if (dialog === "dm" && !selected.length)
              throw new Error("Choose at least one teammate.");
            const name =
              dialog === "dm"
                ? selected
                    .map(
                      (id) =>
                        members.find((m) => m.user_id === id)?.profile
                          ?.display_name || "Teammate",
                    )
                    .join(", ")
                    .slice(0, 80)
                : String(f.get("name"));
            const c = await relay.createConversation({
              workspaceId: workspace.id,
              name,
              kind: dialog === "dm" ? "dm" : kind,
              description: String(f.get("description") || ""),
              memberIds: selected,
            });
            onConversation(c);
            await done();
          }}
        >
          {dialog === "channel" && (
            <>
              <Field
                label="Channel name"
                name="name"
                placeholder="e.g. design-studio"
                required
                pattern="[a-z0-9][a-z0-9_-]*"
                maxLength={80}
              />
              <Field
                label="Description (optional)"
                name="description"
                placeholder="What’s this channel for?"
                maxLength={500}
              />
              <div className="visibility-options">
                <button
                  type="button"
                  className={kind === "public" ? "selected" : ""}
                  onClick={() => setKind("public")}
                >
                  <Hash size={20} />
                  <span>
                    <strong>Public</strong>
                    <small>Anyone in your workspace can find and join.</small>
                  </span>
                  {kind === "public" && <Check size={17} />}
                </button>
                <button
                  type="button"
                  className={kind === "private" ? "selected" : ""}
                  onClick={() => setKind("private")}
                >
                  <LockKeyhole size={18} />
                  <span>
                    <strong>Private</strong>
                    <small>Only invited members can see this channel.</small>
                  </span>
                  {kind === "private" && <Check size={17} />}
                </button>
              </div>
            </>
          )}
          {(dialog === "dm" || kind === "private") && (
            <>
              <p className="field-label">Add teammates</p>
              {checklist}
            </>
          )}
        </TaskForm>
      </Modal>
      <Modal
        title="Good work is better together."
        description={`Invite teammates to ${workspace?.name || "your workspace"}.`}
        open={dialog === "invite"}
        onClose={close}
      >
        {admin ? (
          <>
            {invite ? (
              <div className="invite-ready">
                <div className="success-symbol">
                  <Check size={25} />
                </div>
                <h3>Your invitation is ready.</h3>
                <p>
                  This secure link expires in 7 days. Share it with your team.
                </p>
                <div className="copy-field">
                  <input readOnly aria-label="Invitation link" value={invite} />
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(invite);
                        setCopied(true);
                      } catch {
                        onError(
                          "Could not copy the link. Select and copy it manually.",
                        );
                      }
                    }}
                  >
                    {copied ? <Check size={17} /> : <Copy size={17} />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            ) : (
              <TaskForm
                label="Create secure invitation link"
                submit={async () => {
                  if (!workspace) return;
                  const result = await relay.createInvite(workspace.id);
                  const link = new URL("/", location.origin);
                  link.searchParams.set("invite", result.token);
                  setInvite(link.href);
                }}
              >
                <p className="field-hint">
                  Anyone with this link can join as a member. Invitations are
                  stored as secure hashes and have a limited lifetime.
                </p>
              </TaskForm>
            )}
          </>
        ) : (
          <p className="notice">
            Ask a workspace owner or administrator to create an invitation.
          </p>
        )}
      </Modal>
      <Modal
        title="Join your team"
        description="Paste the secure invitation link your teammate shared."
        open={dialog === "join"}
        onClose={close}
      >
        <TaskForm
          label="Join workspace"
          submit={async (f) => {
            const value = String(f.get("token")).trim();
            let token = value;
            try {
              token = new URL(value).searchParams.get("invite") || value;
            } catch {}
            const w = await relay.acceptInvite(token);
            onWorkspace(w);
            await done();
          }}
        >
          <Field
            label="Invitation link or token"
            name="token"
            required
            placeholder="Paste your invitation"
          />
        </TaskForm>
      </Modal>
      <Modal
        title="Make yourself at home"
        description="Your profile, workspace, and preferences."
        open={dialog === "settings"}
        onClose={close}
        wide
      >
        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Settings sections">
            {[
              ["profile", User, "My profile"],
              ["preferences", Monitor, "Preferences"],
              ["security", ShieldCheck, "Account & security"],
              ...(admin
                ? [
                    ["workspace", Users, "Workspace"],
                    ["members", Users, "Members"],
                    ["invitations", Users, "Invitations"],
                    ["audit", ShieldCheck, "Audit log"],
                  ]
                : []),
            ].map(([key, Icon, label]) => {
              const Component = Icon as typeof User;
              return (
                <button
                  key={String(key)}
                  className={settingsTab === key ? "active" : ""}
                  onClick={() => setSettingsTab(String(key))}
                >
                  <Component size={16} />
                  {String(label)}
                </button>
              );
            })}
          </nav>
          <section className="settings-content">
            {settingsTab === "profile" && (
              <TaskForm
                submit={async (f) => {
                  await relay.updateProfile({
                    display_name: String(f.get("display_name")),
                    username: String(f.get("username")),
                    title: String(f.get("title")),
                    bio: String(f.get("bio")),
                    status: String(f.get("status")),
                  });
                  await onDone();
                }}
              >
                <ProfileImageSettings
                  profile={profile}
                  onUpdated={onDone}
                  onError={onError}
                />
                <div className="profile-preview">
                  <Avatar
                    name={profile.display_name}
                    url={profile.avatar_url}
                    avatarPath={profile.avatar_path}
                  />
                  <div>
                    <strong>{profile.display_name}</strong>
                    <p>Your teammates will see this profile.</p>
                  </div>
                </div>
                <Field
                  label="Display name"
                  name="display_name"
                  defaultValue={profile.display_name}
                  maxLength={80}
                  required
                />
                <Field
                  label="Username"
                  name="username"
                  defaultValue={profile.username}
                  pattern="[a-z0-9_]{3,40}"
                  minLength={3}
                  maxLength={40}
                  required
                />
                <Field
                  label="Job title"
                  name="title"
                  defaultValue={profile.title}
                  maxLength={100}
                />
                <Field
                  label="Bio"
                  name="bio"
                  defaultValue={profile.bio}
                  maxLength={500}
                />
                <Field
                  label="Custom status"
                  name="status"
                  defaultValue={profile.status}
                  maxLength={100}
                  placeholder="e.g. Focus time until 2 pm"
                />
              </TaskForm>
            )}
            {settingsTab === "preferences" && (
              <div className="preference-list">
                <h3>Make Relay yours.</h3>
                <p className="field-label">Appearance</p>
                <div className="theme-options">
                  {[
                    ["light", Sun],
                    ["dark", Moon],
                    ["system", Monitor],
                  ].map(([t, Icon]) => {
                    const Component = Icon as typeof Sun;
                    return (
                      <button
                        key={String(t)}
                        className={theme === t ? "selected" : ""}
                        onClick={() => setTheme(String(t))}
                      >
                        <Component size={22} />
                        {String(t)}
                      </button>
                    );
                  })}
                </div>
                <hr />
                <h4>Notifications</h4>
                <button
                  className="secondary"
                  onClick={async () => {
                    if (!("Notification" in window))
                      return onError(
                        "This browser does not support desktop notifications.",
                      );
                    const permission = await Notification.requestPermission();
                    onError(
                      permission === "granted"
                        ? "Desktop notifications enabled."
                        : "Notifications are blocked. You can allow them in your browser settings.",
                    );
                  }}
                >
                  <Bell size={16} />
                  Enable desktop notifications
                </button>
                <TaskForm
                  label="Update quiet hours"
                  submit={async (f) => {
                    const date = String(f.get("dnd"));
                    await relay.updateProfile({
                      dnd_until: date ? new Date(date).toISOString() : null,
                    });
                    await onDone();
                  }}
                >
                  <Field
                    label="Do not disturb until (optional)"
                    name="dnd"
                    type="datetime-local"
                  />
                  <p className="field-hint">
                    Clear the time to resume notifications.
                  </p>
                </TaskForm>
                {typeof window !== "undefined" && "relayDesktop" in window && (
                  <>
                    <hr />
                    <h4>Desktop</h4>
                    <button
                      className="secondary"
                      onClick={async () => {
                        const bridge = (
                          window as unknown as {
                            relayDesktop: {
                              setLaunchAtStartup(v: boolean): Promise<unknown>;
                            };
                          }
                        ).relayDesktop;
                        try {
                          await bridge.setLaunchAtStartup(!launch);
                          setLaunch(!launch);
                        } catch (err) {
                          onError(
                            err instanceof Error
                              ? err.message
                              : "Startup preference could not be saved.",
                          );
                        }
                      }}
                    >
                      <Laptop size={16} />
                      {launch ? "Disable" : "Enable"} launch at startup
                    </button>
                  </>
                )}
              </div>
            )}
            {settingsTab === "security" && (
              <div className="preference-list">
                <h3>Keep your account secure.</h3>
                <TaskForm
                  label="Email password reset link"
                  submit={async () => {
                    const { data } = await getBrowserClient().auth.getUser();
                    if (data.user?.email) {
                      await requestPasswordReset(data.user.email);
                      onError(
                        "A password reset link was requested. Check your inbox.",
                      );
                    }
                  }}
                >
                  <p className="field-hint">
                    We’ll send a secure link to your account’s email address.
                  </p>
                </TaskForm>
                <hr />
                <TaskForm
                  label="Sign out other sessions"
                  submit={async () => {
                    await signOut("others");
                    onError(
                      "Other refresh sessions revoked. Existing access tokens remain valid until expiry.",
                    );
                  }}
                >
                  <p className="field-hint">
                    Other devices will need to sign in again after their access
                    tokens expire.
                  </p>
                </TaskForm>
                <hr />
                <button
                  className="secondary danger-text"
                  onClick={() =>
                    void signOut("global").catch((e) => onError(e.message))
                  }
                >
                  <LogOut size={16} />
                  Sign out everywhere
                </button>
              </div>
            )}
            {settingsTab === "workspace" && workspace && (
              <TaskForm
                submit={async (f) => {
                  await relay.updateWorkspace(
                    workspace.id,
                    String(f.get("name")),
                  );
                  await onDone();
                }}
              >
                <Field
                  label="Workspace name"
                  name="name"
                  defaultValue={workspace.name}
                  required
                  minLength={2}
                  maxLength={80}
                />
                <WorkspaceImageSettings
                  workspace={workspace}
                  onUpdated={onDone}
                  onError={onError}
                />
              </TaskForm>
            )}
            {settingsTab === "workspace" && role === "owner" && workspace && (
              <>
                <hr />
                <h4>Transfer ownership</h4>
                <TaskForm
                  label="Transfer ownership"
                  submit={async (f) => {
                    const id = String(f.get("owner"));
                    if (
                      !confirm(
                        "Transfer ownership to this teammate? You will become an administrator.",
                      )
                    )
                      return;
                    await relay.transferOwnership(workspace.id, id);
                    await onDone();
                  }}
                >
                  <label className="field">
                    <span>New workspace owner</span>
                    <select name="owner" required>
                      <option value="">Choose a teammate…</option>
                      {members
                        .filter((m) => m.user_id !== profile.id)
                        .map((m) => (
                          <option key={m.user_id} value={m.user_id}>
                            {m.profile?.display_name}
                          </option>
                        ))}
                    </select>
                  </label>
                </TaskForm>
              </>
            )}
            {settingsTab === "security" && workspace && role !== "owner" && (
              <>
                <hr />
                <button
                  className="secondary danger-text"
                  onClick={async () => {
                    if (
                      !confirm(
                        "Leave this workspace and its conversations? You will need an invitation to rejoin.",
                      )
                    )
                      return;
                    try {
                      await relay.removeMember(workspace.id, profile.id);
                      await done();
                      location.assign("/");
                    } catch (err) {
                      onError(
                        err instanceof Error
                          ? err.message
                          : "Could not leave workspace.",
                      );
                    }
                  }}
                >
                  Leave {workspace.name}
                </button>
              </>
            )}
            {settingsTab === "audit" && (
              <div>
                <h3>Workspace audit log</h3>
                <p className="field-hint">
                  The most recent 100 administrative events. Only workspace
                  administrators can read this log.
                </p>
                <div className="audit-list">
                  {audit.map((event) => (
                    <div key={event.id}>
                      <strong>{event.action}</strong>
                      <span>
                        {members.find((m) => m.user_id === event.actor_id)
                          ?.profile?.display_name || "Former teammate"}
                      </span>
                      <time>{new Date(event.created_at).toLocaleString()}</time>
                    </div>
                  ))}
                  {!audit.length && (
                    <p className="field-hint">
                      No administrative events to show.
                    </p>
                  )}
                </div>
              </div>
            )}
            {settingsTab === "invitations" && (
              <div>
                <h3>Workspace invitations</h3>
                <p className="field-hint">
                  Raw tokens are shown only when created. Revoke a link to
                  prevent future joins.
                </p>
                <div className="audit-list">
                  {invitations.map((invite) => (
                    <div key={invite.id}>
                      <strong>
                        {new Date(invite.expires_at) > new Date()
                          ? "Active invitation"
                          : "Expired invitation"}
                      </strong>
                      <span>
                        {invite.uses} / {invite.max_uses} uses · expires{" "}
                        {new Date(invite.expires_at).toLocaleDateString()}
                      </span>
                      {new Date(invite.expires_at) > new Date() && (
                        <button
                          className="text-link danger-text"
                          onClick={async () => {
                            try {
                              await relay.revokeInvite(invite.id);
                              setInvitations((rows) =>
                                rows.map((row) =>
                                  row.id === invite.id
                                    ? {
                                        ...row,
                                        expires_at: new Date().toISOString(),
                                      }
                                    : row,
                                ),
                              );
                            } catch (err) {
                              onError(
                                err instanceof Error
                                  ? err.message
                                  : "Could not revoke invitation.",
                              );
                            }
                          }}
                        >
                          Revoke invitation
                        </button>
                      )}
                    </div>
                  ))}
                  {!invitations.length && (
                    <p className="field-hint">No invitations created yet.</p>
                  )}
                </div>
              </div>
            )}
            {settingsTab === "members" && workspace && (
              <div>
                <h3>People in {workspace.name}</h3>
                <div className="settings-members">
                  {members.map((m) => (
                    <div key={m.user_id}>
                      <Avatar
                        small
                        name={m.profile?.display_name}
                        url={m.profile?.avatar_url}
                        avatarPath={m.profile?.avatar_path}
                      />
                      <span>
                        <strong>{m.profile?.display_name}</strong>
                        <small>{m.role}</small>
                      </span>
                      {m.user_id !== profile.id && m.role !== "owner" && (
                        <>
                          <select
                            aria-label={`Role for ${m.profile?.display_name}`}
                            value={m.role}
                            disabled={role !== "owner"}
                            onChange={async (e) => {
                              try {
                                await relay.setMemberRole(
                                  workspace.id,
                                  m.user_id,
                                  e.target.value as "admin" | "member",
                                );
                                await onDone();
                              } catch (err) {
                                onError(
                                  err instanceof Error
                                    ? err.message
                                    : "Could not update role.",
                                );
                              }
                            }}
                          >
                            <option value="member">Member</option>
                            <option value="admin">Admin</option>
                          </select>
                          <button
                            className="text-link danger-text"
                            onClick={async () => {
                              if (
                                !confirm(
                                  `Remove ${m.profile?.display_name} from this workspace?`,
                                )
                              )
                                return;
                              try {
                                await relay.removeMember(
                                  workspace.id,
                                  m.user_id,
                                );
                                await onDone();
                              } catch (err) {
                                onError(
                                  err instanceof Error
                                    ? err.message
                                    : "Could not remove member.",
                                );
                              }
                            }}
                          >
                            Remove
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      </Modal>
      <Modal
        title={
          conversation
            ? `${conversation.kind !== "dm" ? "# " : ""}${conversation.name}`
            : "Conversation"
        }
        description="Conversation details, people, and notification preferences."
        open={dialog === "details"}
        onClose={close}
      >
        {conversation && (
          <>
            <div className="detail-tabs">
              <button
                className={detailTab === "about" ? "active" : ""}
                onClick={() => setDetailTab("about")}
              >
                About
              </button>
              <button
                className={detailTab === "people" ? "active" : ""}
                onClick={() => setDetailTab("people")}
              >
                Members
              </button>
            </div>
            {detailTab === "about" ? (
              <>
                <TaskForm
                  submit={async (f) => {
                    await relay.updateConversation(conversation.id, {
                      name: String(f.get("name")),
                      description: String(f.get("description")),
                      topic: String(f.get("topic")),
                      archive: !!conversation.archived_at,
                    });
                    await done();
                  }}
                >
                  <Field
                    label="Name"
                    name="name"
                    defaultValue={conversation.name}
                    required
                    maxLength={80}
                    disabled={!admin && conversation.created_by !== profile.id}
                  />
                  <Field
                    label="Topic"
                    name="topic"
                    defaultValue={conversation.topic}
                    maxLength={250}
                  />
                  <Field
                    label="Description"
                    name="description"
                    defaultValue={conversation.description}
                    maxLength={500}
                  />
                  <p className="field-hint">
                    {conversation.kind === "public"
                      ? "Public · Anyone in this workspace can join"
                      : conversation.kind === "private"
                        ? "Private · Only invited members have access"
                        : "Direct message · Participants only"}
                  </p>
                </TaskForm>
                <hr />
                <label className="field">
                  <span>Notify me about</span>
                  <select
                    defaultValue="all"
                    onChange={async (e) => {
                      try {
                        await relay.setNotificationPreference(
                          conversation.id,
                          e.target.value as "all" | "mentions" | "mute",
                        );
                      } catch (err) {
                        onError(
                          err instanceof Error
                            ? err.message
                            : "Could not save preference.",
                        );
                      }
                    }}
                  >
                    <option value="all">All messages</option>
                    <option value="mentions">Mentions only</option>
                    <option value="mute">
                      Nothing — mute this conversation
                    </option>
                  </select>
                </label>
                <div className="channel-danger">
                  <button
                    className="secondary"
                    onClick={async () => {
                      try {
                        if (participants.includes(profile.id))
                          await relay.leaveConversation(conversation.id);
                        else await relay.joinConversation(conversation.id);
                        await done();
                      } catch (err) {
                        onError(
                          err instanceof Error
                            ? err.message
                            : "Could not change membership.",
                        );
                      }
                    }}
                  >
                    {participants.includes(profile.id)
                      ? "Leave conversation"
                      : "Join conversation"}
                  </button>
                  {(admin || conversation.created_by === profile.id) &&
                    conversation.kind !== "dm" && (
                      <button
                        className="secondary danger-text"
                        onClick={async () => {
                          try {
                            await relay.updateConversation(conversation.id, {
                              name: conversation.name,
                              description: conversation.description,
                              topic: conversation.topic,
                              archive: !conversation.archived_at,
                            });
                            await done();
                          } catch (err) {
                            onError(
                              err instanceof Error
                                ? err.message
                                : "Could not archive conversation.",
                            );
                          }
                        }}
                      >
                        {conversation.archived_at ? "Unarchive" : "Archive"}{" "}
                        channel
                      </button>
                    )}
                  {(admin || conversation.created_by === profile.id) &&
                    conversation.kind !== "dm" && (
                      <button
                        className="secondary danger-text"
                        onClick={async () => {
                          if (
                            !confirm(
                              `Permanently delete #${conversation.name}, including messages and threads? This cannot be undone.`,
                            )
                          )
                            return;
                          try {
                            await relay.deleteConversation(conversation.id);
                            await done();
                          } catch (err) {
                            onError(
                              err instanceof Error
                                ? err.message
                                : "Could not delete channel.",
                            );
                          }
                        }}
                      >
                        Delete channel
                      </button>
                    )}
                </div>
              </>
            ) : (
              <div className="detail-people">
                {members
                  .filter((m) => participants.includes(m.user_id))
                  .map((m) => (
                    <div key={m.user_id}>
                      <Avatar
                        small
                        name={m.profile?.display_name}
                        url={m.profile?.avatar_url}
                        avatarPath={m.profile?.avatar_path}
                      />
                      <span>
                        {m.profile?.display_name}
                        <small>{m.profile?.title}</small>
                      </span>
                      {m.user_id !== profile.id &&
                        conversation.kind !== "dm" &&
                        (admin || conversation.created_by === profile.id) && (
                          <button
                            className="text-link danger-text"
                            onClick={async () => {
                              try {
                                await relay.removeConversationMember(
                                  conversation.id,
                                  m.user_id,
                                );
                                setParticipants((ids) =>
                                  ids.filter((id) => id !== m.user_id),
                                );
                              } catch (err) {
                                onError(
                                  err instanceof Error
                                    ? err.message
                                    : "Could not remove participant.",
                                );
                              }
                            }}
                          >
                            Remove
                          </button>
                        )}
                    </div>
                  ))}
                {(admin || conversation.created_by === profile.id) && (
                  <TaskForm
                    label="Add teammate"
                    submit={async (f) => {
                      await relay.addConversationMember(
                        conversation.id,
                        String(f.get("member")),
                      );
                      const rows = await relay.conversationMembers(
                        conversation.id,
                      );
                      setParticipants(rows.map((r) => r.user_id));
                    }}
                  >
                    <label className="field">
                      <span>Add a workspace member</span>
                      <select name="member" required>
                        <option value="">Choose a teammate…</option>
                        {members
                          .filter((m) => !participants.includes(m.user_id))
                          .map((m) => (
                            <option key={m.user_id} value={m.user_id}>
                              {m.profile?.display_name}
                            </option>
                          ))}
                      </select>
                    </label>
                  </TaskForm>
                )}
              </div>
            )}
          </>
        )}
      </Modal>
      <Modal
        title="A few useful shortcuts"
        open={dialog === "shortcuts"}
        onClose={close}
      >
        <div className="shortcuts-list">
          {[
            ["Search your workspace", "Ctrl / ⌘ K"],
            ["Open keyboard shortcuts", "Ctrl / ⌘ /"],
            ["Send a message", "Enter"],
            ["New line in a message", "Shift Enter"],
            ["Close a dialog", "Escape"],
            ["Navigate controls", "Tab / Shift Tab"],
          ].map(([text, key]) => (
            <div key={text}>
              <span>{text}</span>
              <kbd>{key}</kbd>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Bell,
  Bookmark,
  Check,
  ChevronDown,
  CircleHelp,
  FileText,
  Hash,
  Home,
  Keyboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  MessageCircle,
  MessagesSquare,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Users,
  X,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "@/lib/env";
import { getBrowserClient } from "@/lib/supabase/browser";
import { signOut } from "@/lib/auth";
import { relay } from "@/lib/relay";
import { uuid } from "@/lib/validation";
import { subscribeNotifications, subscribeWorkspace } from "@/lib/realtime";
import type {
  Conversation,
  Message,
  Notification as RelayNotification,
  Profile,
  Workspace,
  WorkspaceMember,
} from "@/lib/types";
import { AuthScreen } from "./auth-screen";
import { Avatar, Empty, IconButton, Modal, TaskForm } from "./ui";
import { ConversationView } from "./conversation-view";
import { WorkspaceDialogs, type DialogType } from "./workspace-dialogs";
import { CollectionView, SearchDialog } from "./collections";
import type { MessageAction } from "./message-card";
import { PrivateMediaImage } from "./media-settings";

export function RelayApp() {
  const [boot, setBoot] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState("");
  const [jumpMessage, setJumpMessage] = useState("");
  const [openThreadId, setOpenThreadId] = useState("");
  const [threadUnread, setThreadUnread] = useState(0);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [notifications, setNotifications] = useState<RelayNotification[]>([]);
  const [unreadByConversation, setUnreadByConversation] = useState<
    Record<string, number>
  >({});
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [view, setView] = useState("home");
  const [dialog, setDialog] = useState<DialogType>(null);
  const [search, setSearch] = useState(false);
  const [workspaceMenu, setWorkspaceMenu] = useState(false);
  const [profileMenu, setProfileMenu] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [channelFilter, setChannelFilter] = useState("");
  const [theme, setThemeState] = useState("system");
  const [toast, setToast] = useState("");
  const [fatal, setFatal] = useState("");
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [edit, setEdit] = useState<Message | null>(null);
  const [remove, setRemove] = useState<Message | null>(null);
  const [forward, setForward] = useState<Message | null>(null);
  const [inviteToken, setInviteToken] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const seenNotifications = useRef(new Set<string>());
  const currentWorkspace = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const workspace = workspaces.find((w) => w.id === workspaceId);
  const conversation = conversations.find((c) => c.id === conversationId);
  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(""), 7000);
  }, []);
  const setTheme = useCallback((value: string) => {
    setThemeState(value);
    localStorage.setItem("relay:theme", value);
    const dark =
      value === "dark" ||
      (value === "system" &&
        matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, []);
  const refreshAll = useCallback(async () => {
    if (!user) return;
    const [p, ws] = await Promise.all([
      relay.profile(user.id),
      relay.workspaces(),
    ]);
    setProfile(p);
    setWorkspaces(ws);
    if (workspaceId) {
      const [cs, ms, ns, sv] = await Promise.all([
        relay.conversations(workspaceId),
        relay.members(workspaceId),
        relay.notifications(workspaceId),
        relay.savedIds(workspaceId),
      ]);
      if (currentWorkspace.current !== workspaceId) return;
      setConversations(cs);
      setMembers(ms);
      setNotifications(ns);
      setSavedIds(new Set(sv));
    }
    window.dispatchEvent(new Event("relay:refresh"));
  }, [user?.id, workspaceId]);
  useEffect(() => {
    setTheme(localStorage.getItem("relay:theme") || "system");
    const media = matchMedia("(prefers-color-scheme: dark)");
    const listener = () => {
      if ((localStorage.getItem("relay:theme") || "system") === "system")
        setTheme("system");
    };
    media.addEventListener("change", listener);
    const params = new URLSearchParams(location.search);
    setWorkspaceId(
      params.get("workspace") || localStorage.getItem("relay:workspace") || "",
    );
    setConversationId(params.get("conversation") || "");
    setJumpMessage(params.get("message") || "");
    setOpenThreadId(params.get("thread") || "");
    const pendingInvite =
      params.get("invite") ||
      sessionStorage.getItem("relay:pending-invite") ||
      "";
    setInviteToken(pendingInvite);
    if (pendingInvite)
      sessionStorage.setItem("relay:pending-invite", pendingInvite);
    const authError = params.get("auth_error");
    if (authError) notify(authError);
    if (!isSupabaseConfigured()) {
      setBoot(false);
      return () => media.removeEventListener("change", listener);
    }
    const client = getBrowserClient();
    let active = true;
    client.auth
      .getUser()
      .then(({ data, error }) => {
        if (!active) return;
        setUser(data.user);
        if (error && error.name !== "AuthSessionMissingError")
          notify(error.message);
        setBoot(false);
      })
      .catch((err) => {
        if (active) {
          setBoot(false);
          notify(err.message);
        }
      });
    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      if (active) {
        setUser(session?.user ?? null);
        setBoot(false);
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
      media.removeEventListener("change", listener);
      clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    if (!user) {
      setProfile(null);
      setWorkspaces([]);
      return;
    }
    let active = true;
    setFatal("");
    Promise.all([relay.profile(user.id), relay.workspaces()])
      .then(([p, ws]) => {
        if (!active) return;
        setProfile(p);
        setWorkspaces(ws);
        if (!p)
          setFatal(
            "Your profile could not be found. Ensure the database migrations and account trigger have been applied.",
          );
        setWorkspaceId((id) =>
          ws.some((w) => w.id === id) ? id : ws[0]?.id || "",
        );
      })
      .catch((err) => {
        if (active) setFatal(err.message);
      });
    return () => {
      active = false;
    };
  }, [user?.id, refreshTick]);
  useEffect(() => {
    if (!workspaceId || !user) {
      setConversations([]);
      setMembers([]);
      return;
    }
    currentWorkspace.current = workspaceId;
    localStorage.setItem("relay:workspace", workspaceId);
    let active = true;
    setLoadingWorkspace(true);
    setConversations([]);
    setNotifications([]);
    setMembers([]);
    setFatal("");
    Promise.all([
      relay.conversations(workspaceId),
      relay.members(workspaceId),
      relay.notifications(workspaceId),
      relay.savedIds(workspaceId),
    ])
      .then(([cs, ms, ns, sv]) => {
        if (!active) return;
        setConversations(cs);
        setMembers(ms);
        setNotifications(ns);
        setSavedIds(new Set(sv));
        seenNotifications.current = new Set(ns.map((n) => n.id));
        setConversationId((id) =>
          cs.some((c) => c.id === id)
            ? id
            : cs.find((c) => !c.archived_at && c.kind !== "dm")?.id || "",
        );
        setLoadingWorkspace(false);
      })
      .catch((err) => {
        if (active) {
          setFatal(err.message);
          setLoadingWorkspace(false);
        }
      });
    return () => {
      active = false;
    };
  }, [workspaceId, user?.id, refreshTick]);
  useEffect(() => {
    if (!user || !workspaceId) return;
    return subscribeNotifications(user.id, async () => {
      try {
        const ns = await relay.notifications(workspaceId);
        if (currentWorkspace.current !== workspaceId) return;
        setNotifications(ns);
        window.dispatchEvent(new Event("relay:refresh"));
        for (const n of ns) {
          if (!seenNotifications.current.has(n.id) && !n.read_at) {
            seenNotifications.current.add(n.id);
            if (
              n.conversation_id !== conversationId ||
              document.visibilityState !== "visible"
            ) {
              if (
                profile?.dnd_until &&
                new Date(profile.dnd_until).getTime() > Date.now()
              )
                continue;
              const title =
                n.kind === "mention"
                  ? "You were mentioned in Relay"
                  : "A new conversation is waiting";
              const path = `/?workspace=${workspaceId}&conversation=${n.conversation_id}&message=${n.message_id}`;
              const desktop = (
                window as unknown as {
                  relayDesktop?: {
                    notify(input: {
                      title: string;
                      body: string;
                      path: string;
                    }): Promise<unknown>;
                  };
                }
              ).relayDesktop;
              if (desktop)
                void desktop.notify({
                  title,
                  body: workspace?.name || "Your workspace",
                  path,
                });
              else if (
                "Notification" in window &&
                Notification.permission === "granted"
              ) {
                const alert = new Notification(title, {
                  body: workspace?.name,
                  tag: n.id,
                });
                alert.onclick = () => {
                  window.focus();
                  navigate(n.conversation_id, n.message_id);
                  alert.close();
                };
              }
            }
          }
        }
      } catch (err) {
        notify(
          err instanceof Error
            ? err.message
            : "Notifications could not refresh.",
        );
      }
    });
  }, [user?.id, workspaceId, conversationId, profile?.dnd_until]);
  useEffect(() => {
    if (!workspaceId || !user) return;
    let active = true;
    const reload = async () => {
      try {
        const [ws, cs, ms] = await Promise.all([
          relay.workspaces(),
          relay.conversations(workspaceId),
          relay.members(workspaceId),
        ]);
        if (!active) return;
        setWorkspaces(ws);
        setConversations(cs);
        setMembers(ms);
        if (!ws.some((w) => w.id === workspaceId)) {
          setWorkspaceId(ws[0]?.id || "");
          setConversationId("");
        }
        window.dispatchEvent(new Event("relay:refresh"));
      } catch (err) {
        if (active)
          notify(
            err instanceof Error
              ? err.message
              : "Workspace updates could not refresh.",
          );
      }
    };
    const unsubscribe = subscribeWorkspace(
      workspaceId,
      (event) => {
        if (
          event.recovered ||
          [
            "conversations",
            "workspace_members",
            "conversation_members",
            "workspaces",
            "profiles",
          ].includes(event.table || "")
        )
          void reload();
      },
      notify,
    );
    const focus = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", focus);
    return () => {
      active = false;
      unsubscribe();
      document.removeEventListener("visibilitychange", focus);
    };
  }, [workspaceId, user?.id]);
  useEffect(() => {
    const bridge = (
      window as unknown as {
        relayDesktop?: { onDeepLink(cb: (path: string) => void): () => void };
      }
    ).relayDesktop;
    return bridge?.onDeepLink((path) => {
      const url = new URL(path, location.origin);
      const w = url.searchParams.get("workspace");
      if (w) setWorkspaceId(w);
      const c = url.searchParams.get("conversation");
      if (c) {
        setConversationId(c);
        setJumpMessage(url.searchParams.get("message") || "");
        setView("home");
      }
    });
  }, []);
  useEffect(() => {
    const listener = (event: Event) => {
      const value = (event as CustomEvent<string>).detail;
      if (typeof value !== "string") return;
      const url = new URL(value, location.origin);
      const w = url.searchParams.get("workspace"),
        c = url.searchParams.get("conversation");
      if (
        url.origin !== location.origin ||
        !uuid.safeParse(w).success ||
        !uuid.safeParse(c).success
      )
        return;
      setWorkspaceId(w!);
      setConversationId(c!);
      setJumpMessage("");
      setOpenThreadId("");
      setView("home");
      setMobile(false);
      history.replaceState(null, "", url);
    };
    window.addEventListener("relay:navigate", listener);
    return () => window.removeEventListener("relay:navigate", listener);
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "/") {
        e.preventDefault();
        setDialog("shortcuts");
      }
      if (e.key === "Escape") {
        setMobile(false);
        setWorkspaceMenu(false);
        setProfileMenu(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const chooseWorkspace = (w: Workspace) => {
    setWorkspaceId(w.id);
    setWorkspaces((ws) =>
      ws.some((item) => item.id === w.id) ? ws : [...ws, w],
    );
    setView("home");
    setConversationId("");
    setWorkspaceMenu(false);
    setJumpMessage("");
    setOpenThreadId("");
  };
  const navigate = (id: string, messageId = "", threadId = "") => {
    setConversationId(id);
    setJumpMessage(messageId);
    setOpenThreadId(threadId);
    setView("home");
    setMobile(false);
    const url = new URL(location.href);
    url.search = "";
    if (workspaceId) url.searchParams.set("workspace", workspaceId);
    url.searchParams.set("conversation", id);
    if (messageId) url.searchParams.set("message", messageId);
    if (threadId) url.searchParams.set("thread", threadId);
    history.replaceState(null, "", url);
    if (!conversations.some((c) => c.id === id))
      void refreshAll().catch((e) => notify(e.message));
  };
  const messageAction = async (action: MessageAction, message: Message) => {
    try {
      if (action === "save") {
        const saved = await relay.toggleSaved(message.id);
        setSavedIds((ids) => {
          const next = new Set(ids);
          if (saved) next.add(message.id);
          else next.delete(message.id);
          return next;
        });
        notify(
          saved
            ? "Saved for a quieter moment. Find it in Later."
            : "Removed from Later.",
        );
      } else if (action === "pin") {
        const pinned = await relay.pinMessage(message.id);
        window.dispatchEvent(new Event("relay:refresh"));
        notify(pinned ? "Pinned to this conversation." : "Unpinned.");
      } else if (action === "copy") {
        const url = new URL("/", location.origin);
        url.searchParams.set("workspace", workspaceId);
        url.searchParams.set("conversation", message.conversation_id);
        url.searchParams.set("message", message.id);
        await navigator.clipboard.writeText(url.href);
        notify("Message link copied.");
      } else if (action === "edit") setEdit(message);
      else if (action === "delete") setRemove(message);
      else if (action === "forward") setForward(message);
      else if (action === "thread")
        navigate(message.conversation_id, "", message.parent_id || message.id);
    } catch (err) {
      notify(
        err instanceof Error
          ? err.message
          : "The action could not be completed.",
      );
    }
  };
  useEffect(() => {
    if (!workspaceId || !user) {
      setUnreadByConversation({});
      return;
    }
    let active = true;
    relay
      .unreadCounts(workspaceId)
      .then((counts) => {
        if (active) setUnreadByConversation(counts);
      })
      .catch((err) => {
        if (active) notify(err.message);
      });
    return () => {
      active = false;
    };
  }, [notifications, workspaceId, user?.id]);
  useEffect(() => {
    if (!workspaceId || !user) {
      setThreadUnread(0);
      return;
    }
    let active = true;
    relay
      .unreadThreadCounts(workspaceId)
      .then((counts) => {
        if (active)
          setThreadUnread(
            Object.values(counts).reduce((sum, n) => sum + Number(n), 0),
          );
      })
      .catch((err) => {
        if (active) notify(err.message);
      });
    return () => {
      active = false;
    };
  }, [notifications, workspaceId, user?.id]);
  const unreadCount = Object.values(unreadByConversation).reduce(
    (sum, count) => sum + Number(count),
    0,
  );
  const displayedChannels = conversations.filter(
    (c) =>
      c.kind !== "dm" &&
      !c.archived_at &&
      c.name.toLowerCase().includes(channelFilter.toLowerCase()),
  );
  const dms = conversations.filter(
    (c) =>
      c.kind === "dm" &&
      !c.archived_at &&
      c.name.toLowerCase().includes(channelFilter.toLowerCase()),
  );
  if (boot)
    return (
      <main className="boot-screen">
        <span className="brand-mark">
          r<span />
        </span>
        <LoaderCircle className="spin" size={22} />
        <span>Making room for your team…</span>
      </main>
    );
  if (!user)
    return (
      <>
        <AuthScreen />
        {toast && (
          <div className="toast" role="status">
            {toast}
            <button aria-label="Dismiss" onClick={() => setToast("")}>
              <X size={16} />
            </button>
          </div>
        )}
      </>
    );
  if (!profile)
    return (
      <main className="boot-screen">
        <span className="brand-mark">
          r<span />
        </span>
        {fatal ? (
          <>
            <h1>We couldn’t open your workspace.</h1>
            <p role="alert">{fatal}</p>
            <button
              className="primary"
              onClick={() => setRefreshTick((t) => t + 1)}
            >
              Try again
            </button>
            <button
              className="text-link"
              onClick={() => void signOut().catch((e) => notify(e.message))}
            >
              Sign out
            </button>
          </>
        ) : (
          <>
            <LoaderCircle className="spin" size={22} />
            <p>Loading your profile…</p>
          </>
        )}
      </main>
    );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to conversation
      </a>
      <header className="topbar">
        <IconButton
          label="Open workspace navigation"
          className="mobile-menu"
          onClick={() => setMobile(true)}
        >
          <Menu size={19} />
        </IconButton>
        <a className="topbar-brand" href="/" aria-label="Relay home">
          <span className="brand-mark">
            r<span />
          </span>
          <strong>
            relay<span>.</span>
          </strong>
        </a>
        <div className="topbar-history">
          <span>A little closer, even from afar.</span>
        </div>
        <button
          className="global-search"
          onClick={() => setSearch(true)}
          disabled={!workspace}
        >
          <Search size={16} />
          <span>Search {workspace?.name || "your workspace"}</span>
          <kbd>Ctrl K</kbd>
        </button>
        <div className="topbar-actions">
          <IconButton
            label="Keyboard shortcuts"
            onClick={() => setDialog("shortcuts")}
          >
            <Keyboard size={18} />
          </IconButton>
          <IconButton
            label="Help and shortcuts"
            onClick={() => setDialog("shortcuts")}
          >
            <CircleHelp size={19} />
          </IconButton>
          <span className="topbar-divider" />
          <button
            className="profile-trigger"
            aria-label="Open your profile menu"
            aria-expanded={profileMenu}
            onClick={() => setProfileMenu(!profileMenu)}
          >
            <Avatar
              small
              name={profile.display_name}
              url={profile.avatar_url}
              avatarPath={profile.avatar_path}
              online
            />
          </button>
        </div>
      </header>
      <nav className="workspace-rail" aria-label="Workspaces">
        {workspaces.map((w) => (
          <button
            key={w.id}
            className={`workspace-icon ${w.id === workspaceId ? "selected" : ""}`}
            title={w.name}
            aria-label={`Switch to ${w.name}`}
            aria-current={w.id === workspaceId ? "page" : undefined}
            onClick={() => chooseWorkspace(w)}
          >
            {w.logo_path ? (
              <PrivateMediaImage
                path={w.logo_path}
                alt={w.name}
                fallback={w.name.slice(0, 1).toUpperCase()}
              />
            ) : (
              w.name.slice(0, 1).toUpperCase()
            )}
          </button>
        ))}
        <IconButton
          label="Create a workspace"
          className="add-workspace"
          onClick={() => setDialog("workspace")}
        >
          <Plus size={21} />
        </IconButton>
        <div className="rail-bottom">
          <IconButton
            label="Preferences"
            onClick={() => {
              setDialog("settings");
              setProfileMenu(false);
            }}
          >
            <Settings size={21} />
          </IconButton>
        </div>
      </nav>
      {mobile && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`sidebar ${mobile ? "mobile-open" : ""}`}>
        <div className="workspace-heading">
          <button
            onClick={() => setWorkspaceMenu(!workspaceMenu)}
            aria-expanded={workspaceMenu}
          >
            <span>
              <small>YOUR WORKSPACE</small>
              <strong>{workspace?.name || "Welcome to Relay"}</strong>
            </span>
            <ChevronDown size={17} />
          </button>
          <IconButton
            label="New direct message"
            onClick={() => setDialog("dm")}
            disabled={!workspace}
          >
            <MessagesSquare size={19} />
          </IconButton>
        </div>
        {workspaceMenu && (
          <div className="workspace-dropdown">
            <p>Switch workspace</p>
            {workspaces.map((w) => (
              <button key={w.id} onClick={() => chooseWorkspace(w)}>
                <span className="workspace-mini">
                  {w.name[0]?.toUpperCase()}
                </span>
                {w.name}
                {w.id === workspaceId && <Check size={15} />}
              </button>
            ))}
            <hr />
            <button
              onClick={() => {
                setDialog("workspace");
                setWorkspaceMenu(false);
              }}
            >
              <Plus size={16} />
              Create workspace
            </button>
            <button
              onClick={() => {
                setDialog("join");
                setWorkspaceMenu(false);
              }}
            >
              <Users size={16} />
              Join with an invitation
            </button>
            <button
              onClick={() => {
                setDialog("settings");
                setWorkspaceMenu(false);
              }}
            >
              <Settings size={16} />
              Workspace settings
            </button>
          </div>
        )}
        <nav className="primary-nav" aria-label="Main navigation">
          {[
            ["home", Home, "Home"],
            ["activity", Bell, "Activity"],
            ["threads", MessagesSquare, "Threads"],
            ["later", Bookmark, "Later"],
            ["files", FileText, "Files"],
          ].map(([key, Icon, text]) => {
            const Component = Icon as typeof Home;
            return (
              <button
                key={String(key)}
                className={view === key ? "active" : ""}
                onClick={() => {
                  setView(String(key));
                  setMobile(false);
                }}
              >
                <Component size={18} />
                <span>{String(text)}</span>
                {key === "activity" && unreadCount > 0 && (
                  <span className="nav-count">{unreadCount}</span>
                )}
                {key === "threads" && threadUnread > 0 && (
                  <span className="nav-count">{threadUnread}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-separator" />
        <label className="sidebar-filter">
          <Search size={14} />
          <input
            aria-label="Filter channels and direct messages"
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
            placeholder="Find a conversation"
          />
        </label>
        <div className="sidebar-conversations">
          <div className="sidebar-section-heading">
            <span>
              <ChevronDown size={14} />
              Channels
            </span>
            <IconButton
              label="Create channel"
              disabled={!workspace}
              onClick={() => setDialog("channel")}
            >
              <Plus size={16} />
            </IconButton>
          </div>
          {displayedChannels.map((c) => (
            <button
              key={c.id}
              className={`channel-link ${c.id === conversationId && view === "home" ? "selected" : ""} ${unreadByConversation[c.id] ? "unread" : ""}`}
              onClick={() => navigate(c.id)}
            >
              {c.kind === "private" ? (
                <LockKeyhole size={15} />
              ) : (
                <Hash size={17} />
              )}
              <span>{c.name}</span>
              {unreadByConversation[c.id] > 0 && (
                <span className="channel-count">
                  {unreadByConversation[c.id]}
                </span>
              )}
            </button>
          ))}
          {!displayedChannels.length && (
            <p className="sidebar-empty">
              {channelFilter
                ? "No matching channels"
                : loadingWorkspace
                  ? "Loading channels…"
                  : "A place for your next project."}
            </p>
          )}
          <button
            className="sidebar-add"
            disabled={!workspace}
            onClick={() => setDialog("channel")}
          >
            <span>
              <Plus size={14} />
            </span>
            Add a channel
          </button>
          <div className="sidebar-section-heading dm-heading">
            <span>
              <ChevronDown size={14} />
              Direct messages
            </span>
            <IconButton
              label="Start a direct message"
              disabled={!workspace}
              onClick={() => setDialog("dm")}
            >
              <Plus size={16} />
            </IconButton>
          </div>
          {dms.map((c) => (
            <button
              key={c.id}
              className={`channel-link dm-link ${c.id === conversationId && view === "home" ? "selected" : ""}`}
              onClick={() => navigate(c.id)}
            >
              <span className="dm-avatar">{c.name[0]?.toUpperCase()}</span>
              <span>{c.name}</span>
              {unreadByConversation[c.id] > 0 && (
                <span className="channel-count">
                  {unreadByConversation[c.id]}
                </span>
              )}
            </button>
          ))}
          {!dms.length && (
            <p className="sidebar-empty">
              Good conversations start with a hello.
            </p>
          )}
          <button
            className="sidebar-add"
            disabled={!workspace}
            onClick={() => setDialog("dm")}
          >
            <span>
              <Plus size={14} />
            </span>
            New message
          </button>
        </div>
        <div className="sidebar-bottom">
          <button
            className="invite-team"
            disabled={!workspace}
            onClick={() => setDialog("invite")}
          >
            <Users size={18} />
            <span>
              Bring your people.
              <small>Invite teammates to your workspace</small>
            </span>
            <Plus size={16} />
          </button>
          <div className="sidebar-status">
            <span className="live-dot" />A space to do good work.
            <IconButton
              label="Refresh workspace"
              onClick={() => {
                setRefreshTick((t) => t + 1);
              }}
            >
              <RefreshCw size={13} />
            </IconButton>
          </div>
        </div>
      </aside>
      <main id="main-content" className="main-content">
        {fatal ? (
          <div className="workspace-error">
            <Empty icon={<RefreshCw size={30} />} title="Let’s reconnect.">
              {fatal}
            </Empty>
            <button
              className="primary"
              onClick={() => setRefreshTick((t) => t + 1)}
            >
              Try again
            </button>
          </div>
        ) : loadingWorkspace ? (
          <div className="boot-screen">
            <LoaderCircle size={24} className="spin" />
            <p>Opening {workspace?.name}…</p>
          </div>
        ) : !workspace ? (
          <div className="onboarding">
            <div className="onboarding-art">
              <span className="brand-mark">
                r<span />
              </span>
              <span className="onboarding-spark spark-a">+</span>
              <span className="onboarding-spark spark-b">+</span>
              <span className="onboarding-orbit" />
            </div>
            <div className="eyebrow">
              WELCOME, {profile.display_name.split(" ")[0]?.toUpperCase()}
            </div>
            <h1>Make space for your best work.</h1>
            <p>
              Bring your people together. Give your projects a home.
              <br />
              It all starts with your first workspace.
            </p>
            <button className="primary" onClick={() => setDialog("workspace")}>
              Create a workspace
              <ArrowRight size={17} />
            </button>
            <button className="text-link" onClick={() => setDialog("join")}>
              Have an invitation? Join your team
            </button>
            <div className="onboarding-promises">
              <span>
                <Hash size={16} />
                Organize by channel
              </span>
              <span>
                <MessageCircle size={16} />
                Keep conversations connected
              </span>
              <span>
                <LockKeyhole size={16} />
                Stay private by design
              </span>
            </div>
          </div>
        ) : view !== "home" ? (
          <CollectionView
            view={view}
            workspaceId={workspace.id}
            profile={profile}
            conversations={conversations}
            notifications={notifications}
            savedIds={savedIds}
            onAction={(a, m) => void messageAction(a, m)}
            onNavigate={navigate}
            onError={notify}
            onRefresh={() => void refreshAll().catch((e) => notify(e.message))}
          />
        ) : conversation ? (
          <ConversationView
            key={conversation.id}
            conversation={conversation}
            profile={profile}
            members={members}
            savedIds={savedIds}
            jumpMessageId={jumpMessage}
            openThreadId={openThreadId}
            channels={conversations}
            onAction={(a, m) => void messageAction(a, m)}
            onDetails={() => setDialog("details")}
            onMobileMenu={() => setMobile(true)}
            onError={notify}
          />
        ) : (
          <div className="onboarding">
            <div className="empty-icon">
              <Hash size={36} />
            </div>
            <h1>A home for your next conversation.</h1>
            <p>
              Create a channel to gather your team around a project.
              <br />
              Or start with a message to someone you work with.
            </p>
            <button className="primary" onClick={() => setDialog("channel")}>
              <Plus size={17} />
              Create your first channel
            </button>
            <button className="text-link" onClick={() => setDialog("invite")}>
              Invite your teammates
              <ArrowRight size={15} />
            </button>
          </div>
        )}
      </main>
      {profileMenu && (
        <div className="profile-dropdown">
          <div className="profile-dropdown-top">
            <Avatar
              name={profile.display_name}
              url={profile.avatar_url}
              avatarPath={profile.avatar_path}
              online
            />
            <span>
              <strong>{profile.display_name}</strong>
              <small>{profile.status || "Ready for a good conversation"}</small>
            </span>
          </div>
          <hr />
          <button
            onClick={() => {
              setDialog("settings");
              setProfileMenu(false);
            }}
          >
            <UserIcon />
            Edit profile & preferences
          </button>
          <button
            onClick={() => {
              setDialog("shortcuts");
              setProfileMenu(false);
            }}
          >
            <Keyboard size={16} />
            Keyboard shortcuts
          </button>
          <hr />
          <button
            onClick={() => void signOut().catch((e) => notify(e.message))}
          >
            <LogOut size={16} />
            Sign out of Relay
          </button>
        </div>
      )}
      <WorkspaceDialogs
        dialog={dialog}
        close={() => setDialog(null)}
        workspace={workspace}
        conversation={conversation}
        profile={profile}
        members={members}
        onDone={refreshAll}
        onWorkspace={chooseWorkspace}
        onConversation={(c) => {
          setConversations((cs) =>
            cs.some((x) => x.id === c.id) ? cs : [...cs, c],
          );
          navigate(c.id);
        }}
        theme={theme}
        setTheme={setTheme}
        onError={notify}
      />
      <SearchDialog
        open={search}
        close={() => setSearch(false)}
        workspaceId={workspaceId}
        conversations={conversations}
        members={members}
        onNavigate={navigate}
        onError={notify}
      />
      <Modal
        title="Edit your message"
        open={!!edit}
        onClose={() => setEdit(null)}
      >
        <TaskForm
          label="Save message"
          submit={async (f) => {
            if (!edit) return;
            await relay.editMessage(edit.id, String(f.get("body")));
            setEdit(null);
            window.dispatchEvent(new Event("relay:refresh"));
          }}
        >
          <label className="field">
            <span>Message</span>
            <textarea
              name="body"
              defaultValue={edit?.body}
              required
              maxLength={12000}
              rows={5}
            />
          </label>
        </TaskForm>
      </Modal>
      <Modal
        title="Delete this message?"
        description="Your message text and its attachments will no longer be visible. This can’t be undone."
        open={!!remove}
        onClose={() => setRemove(null)}
      >
        <TaskForm
          label="Delete message"
          submit={async () => {
            if (!remove) return;
            await relay.deleteMessage(remove.id);
            setRemove(null);
            window.dispatchEvent(new Event("relay:refresh"));
          }}
        >
          <div className="delete-preview">{remove?.body}</div>
        </TaskForm>
      </Modal>
      <Modal
        title="Bring the conversation along"
        description="Forward this message to another conversation you have access to."
        open={!!forward}
        onClose={() => setForward(null)}
      >
        <TaskForm
          label="Forward message"
          submit={async (f) => {
            if (!forward) return;
            const target = String(f.get("conversation"));
            await relay.sendMessage({
              id: crypto.randomUUID(),
              conversationId: target,
              body: `Forwarded from ${forward.author?.display_name || "a teammate"}:\n\n> ${forward.body.split("\n").join("\n> ")}`,
            });
            setForward(null);
            notify("Message forwarded.");
            window.dispatchEvent(new Event("relay:refresh"));
          }}
        >
          <label className="field">
            <span>Conversation</span>
            <select name="conversation" required>
              <option value="">Choose a conversation…</option>
              {conversations
                .filter((c) => !c.archived_at)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.kind === "dm" ? "" : "#"}
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <div className="delete-preview">{forward?.body}</div>
        </TaskForm>
      </Modal>
      <Modal
        title="Your team is expecting you."
        description="Accept your invitation to join this workspace."
        open={!!inviteToken && !!user}
        onClose={() => setInviteToken("")}
      >
        <TaskForm
          label="Accept invitation"
          submit={async () => {
            const w = await relay.acceptInvite(inviteToken);
            setInviteToken("");
            sessionStorage.removeItem("relay:pending-invite");
            chooseWorkspace(w);
            const url = new URL(location.href);
            url.searchParams.delete("invite");
            history.replaceState(null, "", url);
            await refreshAll();
          }}
        >
          <p className="field-hint">
            You’ll join as a workspace member. Only people in the workspace can
            see its public conversations.
          </p>
        </TaskForm>
      </Modal>
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
function UserIcon() {
  return <Users size={16} />;
}

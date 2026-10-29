"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  Download,
  LoaderCircle,
  RefreshCw,
  Share,
  SquarePlus,
  X,
} from "lucide-react";
import { Modal } from "./ui";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}
type InstallMode = "prompt" | "ios" | null;
const InstallContext = createContext<{
  mode: InstallMode;
  busy: boolean;
  install: () => void;
} | null>(null);

function isStandalone() {
  return (
    window.matchMedia(
      "(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)",
    ).matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    "relayDesktop" in window
  );
}

export function PwaSupport({ children }: { children: React.ReactNode }) {
  const prompt = useRef<InstallPromptEvent | null>(null);
  const installTrigger = useRef<HTMLElement | null>(null);
  const waitingWorker = useRef<ServiceWorker | null>(null);
  const reloadOnUpdate = useRef(false);
  const [mode, setMode] = useState<InstallMode>(null);
  const [busy, setBusy] = useState(false);
  const [guide, setGuide] = useState(false);
  const [error, setError] = useState("");
  const [updateReady, setUpdateReady] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(
      "(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)",
    );
    const ios =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const refreshMode = () => {
      if (isStandalone() || !window.isSecureContext) {
        prompt.current = null;
        setMode(null);
        setGuide(false);
      } else setMode(prompt.current ? "prompt" : ios ? "ios" : null);
    };
    const beforeInstall = (event: Event) => {
      if (isStandalone() || !window.isSecureContext) return;
      event.preventDefault();
      prompt.current = event as InstallPromptEvent;
      setError("");
      setMode("prompt");
    };
    const installed = () => {
      prompt.current = null;
      setMode(null);
      setGuide(false);
      setError("");
    };
    refreshMode();
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", installed);
    media.addEventListener("change", refreshMode);
    return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", installed);
      media.removeEventListener("change", refreshMode);
    };
  }, []);

  useEffect(() => {
    // Development builds must not leave a worker controlling changing dev bundles.
    if (
      process.env.NODE_ENV !== "production" ||
      !window.isSecureContext ||
      !("serviceWorker" in navigator) ||
      "relayDesktop" in window
    )
      return;
    let active = true;
    let registration: ServiceWorkerRegistration | undefined;
    let installingWorker: ServiceWorker | null = null;
    const installed = () => {
      if (
        active &&
        installingWorker?.state === "installed" &&
        navigator.serviceWorker.controller
      ) {
        waitingWorker.current = registration?.waiting ?? installingWorker;
        setUpdateReady(true);
      }
    };
    const updateFound = () => {
      installingWorker?.removeEventListener("statechange", installed);
      installingWorker = registration?.installing ?? null;
      installingWorker?.addEventListener("statechange", installed);
    };
    const controllerChanged = () => {
      if (reloadOnUpdate.current) window.location.reload();
    };
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      controllerChanged,
    );
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((value) => {
        if (!active) return;
        registration = value;
        if (value.waiting && navigator.serviceWorker.controller) {
          waitingWorker.current = value.waiting;
          setUpdateReady(true);
        }
        value.addEventListener("updatefound", updateFound);
        if (value.installing) updateFound();
      })
      .catch(() =>
        console.warn(
          "[Relay] Offline support could not start. The online app remains available.",
        ),
      );
    return () => {
      active = false;
      registration?.removeEventListener("updatefound", updateFound);
      installingWorker?.removeEventListener("statechange", installed);
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        controllerChanged,
      );
    };
  }, []);

  async function install() {
    if (busy) return;
    installTrigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setError("");
    if (mode === "ios") {
      setGuide(true);
      return;
    }
    const event = prompt.current;
    if (!event) return;
    // Browser prompts are single-use and must be called from this user gesture.
    prompt.current = null;
    setMode(null);
    setBusy(true);
    try {
      await event.prompt();
      await event.userChoice;
    } catch {
      setError(
        "The browser could not open its installation prompt. Try again from your browser’s install menu.",
      );
    } finally {
      setBusy(false);
    }
  }

  function applyUpdate() {
    if (!waitingWorker.current) return;
    reloadOnUpdate.current = true;
    setUpdating(true);
    waitingWorker.current.postMessage({ type: "SKIP_WAITING" });
  }

  function restoreInstallFocus(event: Event) {
    if (installTrigger.current?.isConnected) {
      event.preventDefault();
      installTrigger.current.focus();
    }
  }

  return (
    <InstallContext.Provider
      value={{
        mode,
        busy,
        install: () => {
          void install();
        },
      }}
    >
      {children}
      <Modal
        title="Install Relay on your device"
        description="Keep your workspace one tap away."
        open={guide}
        onClose={() => setGuide(false)}
        onCloseAutoFocus={restoreInstallFocus}
      >
        <div className="pwa-install-guide">
          <img src="/icons/relay-192.png" width="64" height="64" alt="" />
          <p>Open Relay from your Home Screen in its own app window.</p>
          <ol>
            <li>
              <Share size={19} aria-hidden="true" />
              <span>
                Open your browser’s <strong>Share</strong> menu.
              </span>
            </li>
            <li>
              <SquarePlus size={19} aria-hidden="true" />
              <span>
                Choose <strong>Add to Home Screen</strong>. You may need to
                scroll the menu.
              </span>
            </li>
            <li>
              <span className="pwa-step-number">3</span>
              <span>
                Keep <strong>Open as Web App</strong> enabled if shown, then tap{" "}
                <strong>Add</strong>.
              </span>
            </li>
          </ol>
          <p className="pwa-guide-note">
            If the option is missing, open this website in Safari and try again.
            An internet connection is needed for conversations.
          </p>
        </div>
      </Modal>
      <Modal
        title="Installation unavailable"
        description={error || undefined}
        open={Boolean(error)}
        onClose={() => setError("")}
        onCloseAutoFocus={restoreInstallFocus}
      >
        <button className="button primary" onClick={() => setError("")}>
          Got it
        </button>
      </Modal>
      {updateReady && (
        <aside className="pwa-update-notice" aria-label="App update">
          <div role="status">
            <strong>A fresh version is ready.</strong>
            <span>Reload when you’re ready to update.</span>
          </div>
          <button
            type="button"
            className="pwa-update-button"
            disabled={updating}
            onClick={applyUpdate}
          >
            <RefreshCw size={16} aria-hidden="true" />
            {updating ? "Updating…" : "Reload"}
          </button>
          <button
            type="button"
            className="pwa-dismiss"
            aria-label="Update later"
            disabled={updating}
            onClick={() => setUpdateReady(false)}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </aside>
      )}
    </InstallContext.Provider>
  );
}

export function InstallAppButton({ className = "" }: { className?: string }) {
  const install = useContext(InstallContext);
  if (!install?.mode && !install?.busy) return null;
  return (
    <button
      type="button"
      className={`pwa-install-button ${className}`}
      onClick={install!.install}
      disabled={install!.busy}
      aria-label="Install App"
      title="Install Relay on your device"
    >
      {install!.busy ? (
        <LoaderCircle size={16} className="spin" aria-hidden="true" />
      ) : (
        <Download size={16} aria-hidden="true" />
      )}
      <span>{install!.busy ? "Installing…" : "Install App"}</span>
    </button>
  );
}

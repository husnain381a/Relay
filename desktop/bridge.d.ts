export {};

type RelayUpdateStatus = { state: 'disabled' | 'checking' | 'current' | 'error' | 'available' | 'downloading' | 'ready' | 'ready-to-check'; message: string };
declare global {
  interface Window {
    relayDesktop?: {
      version(): Promise<string>;
      notify(payload: { title: string; body: string; path?: string }): Promise<{ shown: boolean; reason?: string }>;
      getPreferences(): Promise<{ launchAtStartup: boolean; startupAvailable: boolean; updateStatus: RelayUpdateStatus; credentialEncryption: boolean }>;
      setLaunchAtStartup(enabled: boolean): Promise<{ launchAtStartup: boolean }>;
      checkForUpdates(): Promise<RelayUpdateStatus>;
      installUpdate(): Promise<void>;
      onDeepLink(callback: (path: string) => void): () => void;
      onUpdateStatus(callback: (status: RelayUpdateStatus) => void): () => void;
    };
  }
}

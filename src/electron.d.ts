/**
 * Type declarations for the Electron contextBridge API.
 * Exposed as window.divini when the app runs inside Electron.
 * When running in a standard browser window.divini is undefined.
 */

interface DiviniElectronAPI {
  version: () => Promise<string>;
  notify: (title: string, body: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  window: {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
  };
  isDesktop: true;
}

declare global {
  interface Window {
    divini?: DiviniElectronAPI;
  }
}

export {};

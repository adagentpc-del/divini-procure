/**
 * Divini Procure — Electron preload script
 *
 * Exposes a minimal, typed bridge from the main process to the renderer
 * via contextBridge. The renderer accesses this as window.divini.*.
 *
 * Only safe, specific channels are exposed — no full Node.js access.
 */

import { contextBridge, ipcRenderer } from "electron";

const api = {
  /** Returns the Electron app version string (e.g. "1.0.0") */
  version: (): Promise<string> => ipcRenderer.invoke("app:version"),

  /** Show a native OS notification */
  notify: (title: string, body: string): Promise<void> =>
    ipcRenderer.invoke("notify", title, body),

  /** Open a URL in the default OS browser */
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke("open-external", url),

  /** Window controls (for custom title bar on Windows if needed) */
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
    maximize: (): Promise<void> => ipcRenderer.invoke("window:maximize"),
    close: (): Promise<void> => ipcRenderer.invoke("window:close"),
  },

  /** True when running inside Electron */
  isDesktop: true,
};

contextBridge.exposeInMainWorld("divini", api);

// TypeScript declaration for the renderer
export type DiviniElectronAPI = typeof api;

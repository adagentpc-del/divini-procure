/**
 * Divini Procure — Electron main process
 *
 * Dev:  loads http://localhost:5173 (Vite dev server)
 * Prod: loads dist/index.html via file://
 *
 * Features:
 *  - BrowserWindow with native frame + custom title bar controls on Windows
 *  - System tray with quick-access menu
 *  - Auto-updater via electron-updater (checks on startup + every 4 hours)
 *  - Native OS notifications for COI expiry / retainage alerts
 *  - Deep-link protocol handler: divini://
 *  - Single-instance lock (second launch focuses the existing window)
 *  - Remember window bounds between sessions
 */

import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  shell,
  ipcMain,
  Notification,
  session,
} from "electron";
// electron-updater is CommonJS — must use default import then destructure.
import updaterPkg from "electron-updater";
const { autoUpdater } = updaterPkg;
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const PRELOAD = path.join(__dirname, "preload.js");
const ICON_PNG = path.join(ROOT, "public", "logo.png");
const STATE_FILE = path.join(app.getPath("userData"), "window-state.json");

const isDev = !app.isPackaged;
const VITE_DEV_SERVER = "http://localhost:5173";

// ---------------------------------------------------------------------------
// Single-instance lock
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Deep-link protocol (divini://)
// ---------------------------------------------------------------------------
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("divini", process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient("divini");
}

// ---------------------------------------------------------------------------
// Window state persistence
// ---------------------------------------------------------------------------
interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized?: boolean;
}

function loadWindowState(): WindowState {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    return JSON.parse(raw) as WindowState;
  } catch {
    return { width: 1280, height: 800 };
  }
}

function saveWindowState(win: BrowserWindow) {
  try {
    const bounds = win.getBounds();
    const state: WindowState = {
      ...bounds,
      isMaximized: win.isMaximized(),
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch {
    // non-fatal
  }
}

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// ---------------------------------------------------------------------------
// Create main window
// ---------------------------------------------------------------------------
function createWindow() {
  const state = loadWindowState();

  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 900,
    minHeight: 600,
    icon: ICON_PNG,
    title: "Divini Procure",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#0f172a", // slate-900 — matches app bg, prevents white flash
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (state.isMaximized) mainWindow.maximize();

  // Load the app
  if (isDev) {
    mainWindow.loadURL(VITE_DEV_SERVER);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(DIST, "index.html"));
  }

  // Persist window state on close
  mainWindow.on("close", () => {
    if (mainWindow) saveWindowState(mainWindow);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Open external links in the OS browser, not Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://localhost") || url.startsWith("file://")) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  buildAppMenu();
}

// ---------------------------------------------------------------------------
// App menu
// ---------------------------------------------------------------------------
function buildAppMenu() {
  const isMac = process.platform === "darwin";

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [isMac ? { role: "close" as const } : { role: "quit" as const }],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" as const },
        { role: "redo" as const },
        { type: "separator" as const },
        { role: "cut" as const },
        { role: "copy" as const },
        { role: "paste" as const },
        ...(isMac
          ? [
              { role: "pasteAndMatchStyle" as const },
              { role: "delete" as const },
              { role: "selectAll" as const },
            ]
          : [{ role: "delete" as const }, { type: "separator" as const }, { role: "selectAll" as const }]),
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" as const },
        { role: "forceReload" as const },
        ...(isDev ? [{ role: "toggleDevTools" as const }] : []),
        { type: "separator" as const },
        { role: "resetZoom" as const },
        { role: "zoomIn" as const },
        { role: "zoomOut" as const },
        { type: "separator" as const },
        { role: "togglefullscreen" as const },
      ],
    },
    {
      label: "Navigate",
      submenu: [
        {
          label: "Dashboard",
          accelerator: "CmdOrCtrl+1",
          click: () => mainWindow?.webContents.executeJavaScript("window.location.href='/app'"),
        },
        {
          label: "Projects",
          accelerator: "CmdOrCtrl+2",
          click: () => mainWindow?.webContents.executeJavaScript("window.location.href='/projects'"),
        },
        {
          label: "Change Orders",
          accelerator: "CmdOrCtrl+3",
          click: () => mainWindow?.webContents.executeJavaScript("window.location.href='/change-orders'"),
        },
        {
          label: "COI Tracker",
          accelerator: "CmdOrCtrl+4",
          click: () => mainWindow?.webContents.executeJavaScript("window.location.href='/coi-tracker'"),
        },
        {
          label: "Dispute Center",
          accelerator: "CmdOrCtrl+5",
          click: () => mainWindow?.webContents.executeJavaScript("window.location.href='/dispute-center'"),
        },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" as const },
        { role: "zoom" as const },
        ...(isMac
          ? [
              { type: "separator" as const },
              { role: "front" as const },
            ]
          : [{ role: "close" as const }]),
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Divini Procure Docs",
          click: () => shell.openExternal("https://docs.diviniprocure.com"),
        },
        {
          label: "Report an Issue",
          click: () => shell.openExternal("https://diviniprocure.com/support"),
        },
        ...(isDev
          ? [
              { type: "separator" as const },
              {
                label: "Check for Updates",
                click: () => autoUpdater.checkForUpdatesAndNotify(),
              },
            ]
          : []),
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// System tray
// ---------------------------------------------------------------------------
function createTray() {
  const icon = nativeImage.createFromPath(ICON_PNG).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip("Divini Procure");

  const menu = Menu.buildFromTemplate([
    {
      label: "Open Divini Procure",
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    { type: "separator" },
    {
      label: "Dashboard",
      click: () => {
        mainWindow?.show();
        mainWindow?.webContents.executeJavaScript("window.location.href='/app'");
      },
    },
    {
      label: "COI Tracker",
      click: () => {
        mainWindow?.show();
        mainWindow?.webContents.executeJavaScript("window.location.href='/coi-tracker'");
      },
    },
    {
      label: "Retainage",
      click: () => {
        mainWindow?.show();
        mainWindow?.webContents.executeJavaScript("window.location.href='/retainage'");
      },
    },
    {
      label: "Dispute Center",
      click: () => {
        mainWindow?.show();
        mainWindow?.webContents.executeJavaScript("window.location.href='/dispute-center'");
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);

  tray.on("click", () => {
    if (mainWindow?.isVisible()) {
      mainWindow.focus();
    } else {
      mainWindow?.show();
    }
  });
}

// ---------------------------------------------------------------------------
// Auto-updater
// ---------------------------------------------------------------------------
function setupAutoUpdater() {
  if (isDev) return;

  autoUpdater.checkForUpdatesAndNotify();

  // Re-check every 4 hours
  setInterval(
    () => autoUpdater.checkForUpdatesAndNotify(),
    4 * 60 * 60 * 1000,
  );

  autoUpdater.on("update-available", () => {
    sendNotification("Update Available", "A new version of Divini Procure is downloading.");
  });

  autoUpdater.on("update-downloaded", () => {
    sendNotification(
      "Update Ready",
      "Divini Procure will restart to apply the update.",
    );
    setTimeout(() => autoUpdater.quitAndInstall(), 5000);
  });

  autoUpdater.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("[updater] error:", err);
  });
}

// ---------------------------------------------------------------------------
// Native notifications helper
// ---------------------------------------------------------------------------
function sendNotification(title: string, body: string) {
  if (!Notification.isSupported()) return;
  new Notification({ title, body, icon: ICON_PNG }).show();
}

// ---------------------------------------------------------------------------
// IPC handlers — renderer can trigger native features via contextBridge
// ---------------------------------------------------------------------------
ipcMain.handle("app:version", () => app.getVersion());

ipcMain.handle("notify", (_event, title: string, body: string) => {
  sendNotification(title, body);
});

ipcMain.handle("open-external", (_event, url: string) => {
  shell.openExternal(url);
});

ipcMain.handle("window:minimize", () => mainWindow?.minimize());
ipcMain.handle("window:maximize", () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.handle("window:close", () => mainWindow?.close());

// ---------------------------------------------------------------------------
// Deep-link handler (second instance or macOS open-url)
// ---------------------------------------------------------------------------
app.on("second-instance", (_event, argv) => {
  // Windows/Linux: deep link arrives as command-line arg
  const deepLink = argv.find((arg) => arg.startsWith("divini://"));
  if (deepLink) handleDeepLink(deepLink);

  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on("open-url", (_event, url) => {
  handleDeepLink(url);
});

function handleDeepLink(url: string) {
  // e.g. divini://building/abc123 -> /building/abc123
  const path = url.replace("divini://", "");
  mainWindow?.webContents.executeJavaScript(
    `window.location.href = '/${path}'`,
  );
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  // Security: restrict which origins can load in the session
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          isDev
            ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*; img-src 'self' data: blob: http://localhost:*; connect-src 'self' http://localhost:* ws://localhost:*"
            : "default-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https:",
        ],
      },
    });
  });

  createWindow();
  createTray();
  setupAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    tray?.destroy();
    app.quit();
  }
});

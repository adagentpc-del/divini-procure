# Divini Procure — Desktop App

Native desktop app built with Electron, wrapping the Vite + React SPA.
Ships as a signed DMG (macOS), NSIS installer (Windows), and AppImage/deb/rpm (Linux).

## Development

```bash
# 1. Install deps (run from repo root)
npm install          # or pnpm install

# 2. Start Vite dev server + Electron side-by-side
npm run electron:dev
```

Vite hot-reload works normally — changes appear in the Electron window instantly.
The main process restarts are manual (`Ctrl+C` and re-run) for now.

## Building a distributable

```bash
# Build Vite SPA (ELECTRON=true sets base="./" for file:// compatibility)
# + compile electron/main.ts + preload.ts, then run electron-builder

npm run electron:dist       # all platforms (requires correct OS + signing config)
npm run dist:mac            # macOS DMG only
npm run dist:win            # Windows NSIS installer only
npm run dist:linux          # Linux AppImage + deb + rpm only
```

Output goes to `release/`.

## Icons

electron-builder reads icons from `electron/build/`:

| File                        | Platform     | Size          |
|-----------------------------|--------------|---------------|
| `electron/build/icon.icns`  | macOS        | 512x512       |
| `electron/build/icon.ico`   | Windows      | 256x256       |
| `electron/build/icons/`     | Linux        | 16–1024 PNGs  |

Generate these from `public/logo.png` with:

```bash
# macOS: brew install imagemagick
# Then use electron-icon-builder or iconutil
npx electron-icon-builder --input=public/logo.png --output=electron/build
```

## Auto-update

`electron-updater` checks for updates on startup and every 4 hours.
To enable, uncomment the `publish` block in `electron-builder.yml` and set
your GitHub repo or S3 bucket.  Code-sign your builds before releasing.

## Deep links

The app registers the `divini://` protocol.
- `divini://building/abc123` navigates to `/building/abc123`
- `divini://dispute-center` opens the dispute center

## Native features

| Feature              | How it works                                        |
|----------------------|-----------------------------------------------------|
| System tray          | Quick-jump to Dashboard, COI, Retainage, Disputes   |
| Native notifications | `window.divini.notify(title, body)` from renderer   |
| Auto-updater         | electron-updater, checks GitHub Releases / S3       |
| Deep links           | `divini://` protocol registered on install          |
| Window state         | Bounds + maximized state saved to userData          |
| Single instance      | Second launch focuses the existing window           |

## Security

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- All Node.js access goes through typed `contextBridge` channels in `preload.ts`
- External URLs open in the OS browser, not Electron
- CSP headers injected via `session.defaultSession.webRequest.onHeadersReceived`

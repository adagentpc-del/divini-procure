import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// BASE_PATH lets the SPA be served under a sub-path (e.g. "/procure"). Defaults
// to "/". The backend serves the built SPA + the /api router from one process.
//
// ELECTRON=true: use "./" base so assets resolve correctly from file:// URLs.
const isElectron = process.env.ELECTRON === 'true';
const base = isElectron ? './' : (process.env.BASE_PATH || '/');

export default defineConfig({
  base,
  plugins: [react()],
  // In desktop mode the renderer lives in an Electron BrowserWindow —
  // keep the dev server accessible on localhost only.
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    // Ensure output directory is always dist/
    outDir: 'dist',
    emptyOutDir: true,
    // Inline small assets so file:// loads work without a server
    assetsInlineLimit: isElectron ? 8192 : 4096,
  },
});

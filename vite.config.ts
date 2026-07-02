import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// BASE_PATH lets the SPA be served under a sub-path (e.g. "/procure"). Defaults
// to "/". The backend serves the built SPA + the /api router from one process.
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  base,
  plugins: [react()],
});

import type { CapacitorConfig } from '@capacitor/cli';

// Divini Procure native shell (Capacitor).
//
// PRIMARY (managed webview) configuration: the native app loads the HOSTED
// production site over HTTPS via server.url. This is the fastest, lowest-risk
// path for a research-preview launch because Authentik OIDC login works exactly
// as it does on the web (standard browser redirect flow, no native deep-link
// plumbing required). It does mean the app depends on the live HTTPS domain
// being up.
//
// NOTE: server.url points at https://app.diviniprocure.com. That host MUST
// exist and serve the hosted SPA over HTTPS before the native build will load
// anything. Provision DNS + a TLS cert (Caddy) for app.diviniprocure.com first.
//
// App Transport Security (ATS) MUST stay strict: cleartext is false and there
// are NO http origins anywhere in this config. Do not add insecure origins.
//
// Brand color is emerald-deep (#123c2e) for the status bar and splash screen.

const config: CapacitorConfig = {
  appId: 'com.divinigroup.procure',
  appName: 'Divini Procure',
  webDir: 'dist',
  // Managed webview: load the live hosted app. cleartext is false because the
  // site is served over HTTPS only (App Transport Security stays at defaults).
  server: {
    url: 'https://app.diviniprocure.com',
    cleartext: false,
  },
  ios: {
    contentInset: 'always',
    // iOS custom URL scheme used for the in-app webview. Keep as "https" so the
    // webview origin matches the hosted site (helps with OIDC cookie/storage
    // partitioning). Override only if you switch to the bundled-offline mode.
    scheme: 'https',
  },
  android: {
    // Android webview scheme. "https" keeps parity with iOS and the hosted app.
    // allowMixedContent stays false since the app is HTTPS end to end.
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: '#123c2e',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      // Light text/icons on the dark emerald brand bar.
      style: 'DARK',
      backgroundColor: '#123c2e',
      overlaysWebView: false,
    },
  },
};

export default config;

// ---------------------------------------------------------------------------
// ALTERNATIVE (bundled / offline) configuration - LATER OPTION, not active.
//
// Ship the SPA assets INSIDE the app bundle instead of loading the hosted URL.
// This makes the shell work offline and removes the runtime dependency on the
// live domain, but OIDC login needs extra handling (the redirect must return to
// a native custom-scheme deep link, e.g. diviniprocure://callback, and that
// redirect URI must be registered in Authentik). Do NOT enable this without
// doing that login plumbing first.
//
// IMPORTANT: this requires a SEPARATE, relatively-based web build so the app
// can load assets from the local file system. Do this in a throwaway output dir
// so the normal web deploy (which serves at "/") is never touched:
//
//   BASE_PATH=./ npx vite build --outDir dist-native --emptyOutDir
//
// Then use a config like the following (note: no server.url, webDir points at
// the relatively-based build):
//
//   const config: CapacitorConfig = {
//     appId: 'com.divinigroup.procure',
//     appName: 'Divini Procure',
//     webDir: 'dist-native',
//     ios: { contentInset: 'always' },
//     plugins: {
//       SplashScreen: { backgroundColor: '#123c2e', showSpinner: false },
//       StatusBar: { style: 'DARK', backgroundColor: '#123c2e' },
//     },
//   };
// ---------------------------------------------------------------------------

import type { CapacitorConfig } from '@capacitor/cli';

// Divini Procure native shell (Capacitor).
//
// PRIMARY (managed webview) configuration: the native app loads the HOSTED
// production site over HTTPS via server.url. This is the fastest, lowest-risk
// path for a research-preview launch because login works exactly as it does
// on the web: native email/password session auth (server/src/auth.ts) sets
// an httpOnly `divini_session` cookie via a same-origin fetch, so the webview
// just needs to be pointed at the real HTTPS origin - no OIDC redirect flow,
// no native deep-link callback plumbing required (this app retired Authentik
// OIDC; see auth.ts's own header comment). It does mean the app depends on
// the live HTTPS domain being up.
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
// live domain, but the session cookie is set by the API origin
// (app.diviniprocure.com), while bundled assets load from a local
// file/custom-scheme origin - the browser will not send/store that cookie
// for requests made from a different origin. Do NOT enable this without
// first switching the API calls to carry the session as a Bearer token
// (server/src/auth.ts already accepts one as a fallback to the cookie -
// see `bearer()`/`sessionToken()`) instead of relying on the cookie alone.
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

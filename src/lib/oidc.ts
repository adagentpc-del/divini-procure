import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';

// Build-time public values inlined by Vite. NO secret here - the SPA does
// Authorization Code + PKCE against Authentik. Mirrors divinipartner's oidc.ts.
const issuer = import.meta.env.VITE_OIDC_ISSUER as string | undefined; // .../application/o/divini-procure/
const clientId = import.meta.env.VITE_OIDC_CLIENT_ID as string | undefined;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const redirectUri =
  (import.meta.env.VITE_OIDC_REDIRECT_URI as string | undefined) ||
  (typeof window !== 'undefined' ? `${window.location.origin}${basePath}/auth/callback` : '');

if (!issuer || !clientId) {
  // eslint-disable-next-line no-console
  console.error(
    'Missing VITE_OIDC_ISSUER / VITE_OIDC_CLIENT_ID. OIDC login will not work until these are set at build time.'
  );
}

export const userManager = new UserManager({
  authority: issuer ?? '',
  client_id: clientId ?? '',
  redirect_uri: redirectUri,
  post_logout_redirect_uri: typeof window !== 'undefined' ? window.location.origin : '',
  response_type: 'code', // Authorization Code + PKCE
  scope: 'openid profile email',
  userStore: new WebStorageStateStore({ store: window.localStorage }),
  automaticSilentRenew: true,
});

export const getUser = (): Promise<User | null> => userManager.getUser();
export const login = (): Promise<void> => userManager.signinRedirect();
export const logout = (): Promise<void> => userManager.signoutRedirect();
export const completeLogin = (): Promise<User> => userManager.signinRedirectCallback();

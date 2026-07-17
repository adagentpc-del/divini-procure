import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { apiGet, apiSend } from './api';

// One-shot signup attribution: after the user is authed, claim any pending
// invite code (/join/:code) and attribute any referral partner code (/r/:code)
// captured in localStorage by the public landing pages, then clear them. Guarded
// so it fires at most once per page load even if loadMe runs multiple times.
let attributionFired = false;
async function runSignupAttribution(): Promise<void> {
  if (attributionFired) return;
  attributionFired = true;
  let inviteCode: string | null = null;
  let refCode: string | null = null;
  try {
    inviteCode = localStorage.getItem('procure_invite_code');
    refCode = localStorage.getItem('procure_ref_code');
  } catch { /* localStorage unavailable */ }

  if (inviteCode) {
    try {
      await apiSend('POST', `/invites/${encodeURIComponent(inviteCode)}/accept`);
    } catch { /* invalid/revoked invite: leave it, do not block signup */ }
    try { localStorage.removeItem('procure_invite_code'); } catch { /* */ }
  }
  if (refCode) {
    try {
      await apiSend('POST', '/referrals/attribute', { code: refCode });
    } catch { /* invalid/disabled partner: ignore */ }
    try { localStorage.removeItem('procure_ref_code'); } catch { /* */ }
  }
}

export type Company = {
  id: string; kind: 'buyer' | 'vendor'; name: string;
  contact_name?: string; contact_title?: string; phone?: string; email?: string;
  city?: string; region?: string; logo_url?: string; rating?: number;
};

// A minimal session-shaped object so existing page code that reads
// `session.user.id` / `session.user.email` keeps working unchanged.
export type Session = {
  user: { id: string; email: string | null };
};

type MeResponse = { user: { id: string; email: string | null }; isAdmin: boolean; company: Company | null };
// Auth responses no longer include a token in the body - the session is
// maintained exclusively via the httpOnly `divini_session` cookie to prevent
// XSS token theft via localStorage.
type AuthResponse = MeResponse;

// register() returns whether the caller should be sent to a "check your email"
// screen (always true on success), so the Register page can show that state.
type RegisterResult = { ok: boolean; needsVerification: boolean };

type AuthState = {
  session: Session | null;
  company: Company | null;
  isAdmin: boolean;
  loading: boolean;
  refreshCompany: () => Promise<void>;
  // Native auth actions.
  createAccount: (email: string, password: string, passwordConfirm: string, agreed?: boolean) => Promise<RegisterResult>;
  signIn: (email: string, password: string) => Promise<void>;
  verifyEmail: (token: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  resetPassword: (token: string, password: string, passwordConfirm: string) => Promise<void>;
  resendVerification: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthState>({} as AuthState);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  // Apply an authoritative me/auth response into context state.
  function applyMe(me: MeResponse): void {
    setSession({ user: me.user });
    setCompany(me.company ?? null);
    setIsAdmin(me.isAdmin);
  }

  async function loadMe(): Promise<boolean> {
    try {
      const me = await apiGet<MeResponse>('/auth/me');
      applyMe(me);
      void runSignupAttribution();
      return true;
    } catch {
      setSession(null);
      setCompany(null);
      setIsAdmin(false);
      return false;
    }
  }

  async function refreshCompany() {
    if (session?.user) await loadMe();
  }

  useEffect(() => {
    let mounted = true;
    loadMe().finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle an auth response (login / verify / reset): update local state, run
  // attribution. Session is maintained by the httpOnly cookie set by the server.
  function adoptAuth(res: AuthResponse): void {
    applyMe(res);
    void runSignupAttribution();
  }

  const createAccount = async (
    email: string,
    password: string,
    passwordConfirm: string,
    agreed = false,
  ): Promise<RegisterResult> => {
    return apiSend<RegisterResult>('POST', '/auth/register', { email, password, passwordConfirm, agreed });
  };

  const signIn = async (email: string, password: string): Promise<void> => {
    const res = await apiSend<AuthResponse>('POST', '/auth/login', { email, password });
    adoptAuth(res);
  };

  const verifyEmail = async (token: string): Promise<void> => {
    const res = await apiSend<AuthResponse>('POST', '/auth/verify', { token });
    adoptAuth(res);
  };

  const forgotPassword = async (email: string): Promise<void> => {
    await apiSend('POST', '/auth/forgot', { email });
  };

  const resetPassword = async (
    token: string,
    password: string,
    passwordConfirm: string,
  ): Promise<void> => {
    const res = await apiSend<AuthResponse>('POST', '/auth/reset', { token, password, passwordConfirm });
    adoptAuth(res);
  };

  const resendVerification = async (email: string): Promise<void> => {
    await apiSend('POST', '/auth/resend-verification', { email });
  };

  const signOut = async (): Promise<void> => {
    try { await apiSend('POST', '/auth/logout'); } catch { /* ignore */ }
    // Server clears the httpOnly cookie via Set-Cookie on logout.
    setSession(null);
    setCompany(null);
    setIsAdmin(false);
  };

  return (
    <Ctx.Provider
      value={{
        session, company, isAdmin, loading, refreshCompany,
        createAccount, signIn, verifyEmail, forgotPassword, resetPassword,
        resendVerification, signOut,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

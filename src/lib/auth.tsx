import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type Company = {
  id: string; kind: 'buyer' | 'vendor'; name: string;
  contact_name?: string; contact_title?: string; phone?: string; email?: string;
  city?: string; region?: string; logo_url?: string; rating?: number;
};

type AuthState = {
  session: Session | null;
  company: Company | null;
  loading: boolean;
  refreshCompany: () => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthState>({} as AuthState);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadCompany(uid: string) {
    const { data } = await supabase
      .from('company_members')
      .select('company:companies(*)')
      .eq('user_id', uid)
      .limit(1)
      .maybeSingle();
    setCompany((data?.company as unknown as Company) ?? null);
  }

  async function refreshCompany() {
    if (session?.user) await loadCompany(session.user.id);
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session?.user) await loadCompany(data.session.user.id);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      setSession(s);
      if (s?.user) await loadCompany(s.user.id);
      else setCompany(null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => { await supabase.auth.signOut(); setCompany(null); };

  return (
    <Ctx.Provider value={{ session, company, loading, refreshCompany, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

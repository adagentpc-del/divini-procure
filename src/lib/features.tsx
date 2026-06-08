import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from './supabase';
import { useAuth } from './auth';

export const ADMIN_EMAIL = 'adagentpc@gmail.com';

export type Flag = {
  key: string; label: string; description?: string;
  audience: 'buyer' | 'vendor' | 'both' | 'admin';
  enabled: boolean; category?: string; sort?: number;
};

type FeaturesState = {
  flags: Flag[];
  isOn: (key: string) => boolean;
  isAdmin: boolean;
  reload: () => Promise<void>;
};

const Ctx = createContext<FeaturesState>({} as FeaturesState);
export const useFeatures = () => useContext(Ctx);

export function FeaturesProvider({ children }: { children: ReactNode }) {
  const { session, company } = useAuth();
  const [flags, setFlags] = useState<Flag[]>([]);
  const isAdmin = (session?.user?.email ?? '') === ADMIN_EMAIL;

  async function reload() {
    const { data } = await supabase.from('feature_flags').select('*').order('sort');
    setFlags((data as Flag[]) ?? []);
  }
  useEffect(() => { if (session) reload(); }, [session]);

  const role = company?.kind;
  function isOn(key: string) {
    const f = flags.find(x => x.key === key);
    if (!f || !f.enabled) return false;
    if (f.audience === 'both' || isAdmin) return true;
    return f.audience === role;
  }

  return <Ctx.Provider value={{ flags, isOn, isAdmin, reload }}>{children}</Ctx.Provider>;
}

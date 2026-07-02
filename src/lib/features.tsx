import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { getFeatureFlags } from './db';
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
  const { session, company, isAdmin } = useAuth();
  const [flags, setFlags] = useState<Flag[]>([]);

  async function reload() {
    try {
      const data = await getFeatureFlags();
      setFlags((data as Flag[]) ?? []);
    } catch {
      setFlags([]);
    }
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

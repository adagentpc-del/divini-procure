import { createClient } from '@supabase/supabase-js';

// Public, publishable Supabase config. These keys are safe to expose in client
// code (RLS protects the data). Env vars override them when set (e.g. in Vercel).
const FALLBACK_URL = 'https://qrqydaaeswtihmsoztjx.supabase.co';
const FALLBACK_ANON = 'sb_publishable_pfFrm2hRGEi7-s_5C6Gviw_7BcHx8ZN';

const url = (import.meta.env.VITE_SUPABASE_URL as string) || FALLBACK_URL;
const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || FALLBACK_ANON;

export const supabase = createClient(url, anon);

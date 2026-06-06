import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anon) {
  console.warn('Supabase env vars missing — copy .env.example to .env and fill them in.');
}

export const supabase = createClient(url, anon);

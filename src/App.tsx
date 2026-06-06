import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';

export default function App() {
  const [status, setStatus] = useState('Connecting to Supabase…');
  const [counts, setCounts] = useState<Record<string, number | string>>({});

  useEffect(() => {
    (async () => {
      try {
        const tables = ['companies', 'buildings', 'packages', 'bids'];
        const out: Record<string, number | string> = {};
        for (const t of tables) {
          const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
          out[t] = error ? 'n/a' : (count ?? 0);
        }
        setCounts(out);
        setStatus('Connected to Supabase ✓');
      } catch (e: any) {
        setStatus('Could not reach Supabase — check your .env values.');
      }
    })();
  }, []);

  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif', padding: 24, color: '#123c2e', maxWidth: 640, margin: '0 auto' }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Divini Procure</h1>
      <p style={{ color: '#6b6256' }}>{status}</p>
      <p style={{ fontSize: 13, color: '#6b6256' }}>
        Starter app. The full UI ports from the prototype in the repo root. Tables wired:
      </p>
      <ul>
        {Object.entries(counts).map(([t, c]) => (
          <li key={t}><strong>{t}</strong>: {String(c)} rows</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Ask Divini - narrow first slice (docs/ai-layer-design.md section 7).
 * A single-project, financial-questions-only AI assistant. Never computes
 * anything itself - the backend narrates the SAME numbers already shown in
 * ProjectFinancialSummaryPanel, so this is explicitly labeled as an
 * AI-generated summary, never a second source of truth.
 */
import { useState } from 'react';
import { askDiviniAboutProject } from '../lib/db';

export default function AskDiviniPanel({ buildingId }: { buildingId: string }) {
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [disclosure, setDisclosure] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || asking) return;
    setAsking(true);
    setAnswer(null);
    setNote(null);
    try {
      const res = await askDiviniAboutProject(buildingId, question.trim());
      setDisclosure(res.disclosure);
      if (res.ok && res.answer) {
        setAnswer(res.answer);
      } else {
        setNote(res.reason || 'Ask Divini could not answer that question.');
      }
    } catch {
      setNote('Ask Divini is unavailable right now.');
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="sectitle" style={{ margin: 0, marginBottom: 10 }}>Ask Divini</div>
      <div className="note" style={{ marginBottom: 10 }}>
        Ask a question about this project's budget, commitments, invoices, or payments.
      </div>
      <form onSubmit={ask} style={{ display: 'flex', gap: 8 }}>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. Which packages are over allowance?"
          style={{ flex: 1 }}
          maxLength={400}
        />
        <button className="btn primary" disabled={asking || !question.trim()}>
          {asking ? 'Asking…' : 'Ask'}
        </button>
      </form>
      {answer && (
        <div style={{ marginTop: 12 }}>
          <div style={{ whiteSpace: 'pre-wrap' }}>{answer}</div>
          {disclosure && <div className="note" style={{ marginTop: 8, fontSize: 12 }}>{disclosure}</div>}
        </div>
      )}
      {note && !answer && (
        <div className="note" style={{ marginTop: 12 }}>{note}</div>
      )}
    </div>
  );
}

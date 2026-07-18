/**
 * Lightweight toast notification context.
 *
 * Usage:
 *   const { toast } = useToast();
 *   toast('Project saved.', 'success');
 *   toast('Something went wrong.', 'error');
 *
 * Wrap your app (or Shell) in <ToastProvider>. The ToastContainer component
 * renders the queued toasts as an accessible ARIA live region.
 */
import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { randomUUID } from '../lib/uuid';

export type ToastKind = 'success' | 'error' | 'info';

export type ToastItem = {
  id: string;
  message: string;
  kind: ToastKind;
};

type ToastCtx = {
  toasts: ToastItem[];
  toast: (message: string, kind?: ToastKind) => void;
  dismiss: (id: string) => void;
};

const Ctx = createContext<ToastCtx>({
  toasts: [],
  toast: () => {},
  dismiss: () => {},
});

export const useToast = () => useContext(Ctx);

const AUTO_DISMISS_MS: Record<ToastKind, number> = {
  success: 3500,
  info: 4000,
  error: 6000,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = 'success') => {
      const id = randomUUID();
      setToasts((prev) => [...prev.slice(-4), { id, message, kind }]);
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS[kind]);
    },
    [dismiss],
  );

  return <Ctx.Provider value={{ toasts, toast, dismiss }}>{children}</Ctx.Provider>;
}

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

interface ToastState {
  message: string;
  visibleSince: number;
}

const TOAST_VISIBLE_MS = 1800;

interface ToastContextValue {
  showToast: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ClipboardToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<number | null>(null);

  const showToast = useCallback((message: string) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    setToast({ message, visibleSince: Date.now() });
    timerRef.current = window.setTimeout(() => {
      setToast(null);
      timerRef.current = null;
    }, TOAST_VISIBLE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast ? (
        <div className="clipboard-toast" role="status" aria-live="polite">
          {toast.message}
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useClipboardToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      showToast: () => {
        /* no-op outside provider — keeps standalone tests happy */
      },
    };
  }
  return ctx;
}

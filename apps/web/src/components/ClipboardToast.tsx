import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

interface ToastState {
  message: string;
  // When `fallbackText` is set, the toast renders a textarea with the text
  // so the user can copy it manually. This path fires on clipboard-write
  // failure (Safari user-gesture timeout after an await, insecure context,
  // permission denied) so a generated invite is never silently lost.
  fallbackText: string | null;
  visibleSince: number;
}

const TOAST_VISIBLE_MS = 1800;
// The fallback toast stays up longer than the success toast — the user needs
// time to actually select + copy the text.
const TOAST_FALLBACK_MS = 30000;

interface ToastContextValue {
  showToast: (message: string) => void;
  showFallbackText: (message: string, text: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ClipboardToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<number | null>(null);

  const clearPendingTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const showToast = useCallback(
    (message: string) => {
      clearPendingTimer();
      setToast({ message, fallbackText: null, visibleSince: Date.now() });
      timerRef.current = window.setTimeout(() => {
        setToast(null);
        timerRef.current = null;
      }, TOAST_VISIBLE_MS);
    },
    [clearPendingTimer],
  );

  const showFallbackText = useCallback(
    (message: string, text: string) => {
      clearPendingTimer();
      setToast({ message, fallbackText: text, visibleSince: Date.now() });
      timerRef.current = window.setTimeout(() => {
        setToast(null);
        timerRef.current = null;
      }, TOAST_FALLBACK_MS);
    },
    [clearPendingTimer],
  );

  useEffect(() => {
    return () => {
      clearPendingTimer();
    };
  }, [clearPendingTimer]);

  return (
    <ToastContext.Provider value={{ showToast, showFallbackText }}>
      {children}
      {toast ? (
        <div
          className={
            toast.fallbackText
              ? 'clipboard-toast clipboard-toast-fallback'
              : 'clipboard-toast'
          }
          role="status"
          aria-live="polite"
        >
          <div className="clipboard-toast-message">{toast.message}</div>
          {toast.fallbackText ? (
            <>
              <textarea
                className="clipboard-toast-textarea"
                readOnly
                value={toast.fallbackText}
                onFocus={(e) => e.currentTarget.select()}
                rows={6}
                aria-label="可手动复制的邀请文案"
              />
              <button
                type="button"
                className="clipboard-toast-dismiss"
                onClick={() => {
                  clearPendingTimer();
                  setToast(null);
                }}
              >
                关闭
              </button>
            </>
          ) : null}
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
      showFallbackText: () => {
        /* no-op outside provider */
      },
    };
  }
  return ctx;
}

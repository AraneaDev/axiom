import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';
import { useState, useCallback, createContext, useContext, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  toast: (message: string, type?: ToastType) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

/**
 * Access the toast notification API from within a ToastProvider.
 * @returns Object with toast(), success(), error(), and info() methods.
 * @throws {Error} If called outside of a ToastProvider.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

const ICONS = { success: CheckCircle, error: AlertCircle, info: Info };
const STYLES = {
  success: 'bg-success/10 border-success/20 text-success',
  error: 'bg-danger-light border-danger/20 text-danger',
  info: 'bg-primary-light border-primary/20 text-primary',
};

/**
 * Context provider that manages toast notification state.
 * Wrap the application tree with this provider to enable useToast().
 * Toasts auto-dismiss after 4 seconds and render in the bottom-right corner.
 * @param props - Provider props.
 * @param props.children - Application tree that can access the toast API.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setToasts((prev) => [...prev, { id, message, type }]);
      setTimeout(() => removeToast(id), 4000);
    },
    [removeToast],
  );

  const ctx: ToastContextType = {
    toast: addToast,
    success: (msg) => addToast(msg, 'success'),
    error: (msg) => addToast(msg, 'error'),
    info: (msg) => addToast(msg, 'info'),
  };

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => {
          const Icon = ICONS[t.type];
          return (
            <div
              key={t.id}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-4 py-3 shadow-lg shadow-black/10 animate-in slide-in-from-right duration-200',
                STYLES[t.type],
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <p className="text-sm flex-1">{t.message}</p>
              <button
                onClick={() => removeToast(t.id)}
                className="shrink-0 hover:opacity-70"
                title="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

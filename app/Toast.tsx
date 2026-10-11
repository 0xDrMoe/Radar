"use client";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";

type ToastKind = "success" | "error" | "info";
interface ToastItem { id: number; kind: ToastKind; message: string; }
type ToastFn = (message: string, kind?: ToastKind) => void;

const ToastContext = createContext<ToastFn | null>(null);

const ICONS: Record<ToastKind, React.ReactNode> = {
  success: <CheckCircle2 />,
  error: <TriangleAlert />,
  info: <Info />,
};

// One global toast stack mounted once in RootShell so every page (public or admin) can call
// useToast() without threading a prop down — mirrors how ThemeMenu/ClerkClientProvider are
// already mounted once at the root rather than per-page. Mounted outside the intl provider, it is
// handed its one word of its own ("Dismiss") by RootShell, in the page's language.
export function ToastProvider({ children, dismissLabel = "Dismiss" }: { children: React.ReactNode; dismissLabel?: string }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const push = useCallback<ToastFn>((message, kind = "info") => {
    const id = nextId.current++;
    setItems((list) => [...list, { id, kind, message }]);
    setTimeout(() => setItems((list) => list.filter((item) => item.id !== id)), 5000);
  }, []);

  function dismiss(id: number) {
    setItems((list) => list.filter((item) => item.id !== id));
  }

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`toast toast-${item.kind}`}>
            {ICONS[item.kind]}
            <span>{item.message}</span>
            <button type="button" aria-label={dismissLabel} onClick={() => dismiss(item.id)}><X /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// Falls back to a no-op instead of throwing when a page hasn't mounted ToastProvider (there is
// currently always one, via RootShell, but a silent no-op is a safer failure mode for a
// notification helper than crashing the page that called it).
export function useToast(): ToastFn {
  const push = useContext(ToastContext);
  return push || (() => {});
}

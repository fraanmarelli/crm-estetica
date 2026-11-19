"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Ventana que se abre en la misma pantalla (sin cambiar de dirección). En el celular ocupa toda la
// pantalla. Se cierra con la ✕, con Esc o tocando afuera.
export function Dialog({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;
  return createPortal(
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-stretch justify-center bg-black/45 lg:items-start lg:px-6 lg:py-10"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="modal-panel relative flex w-full flex-col overflow-hidden bg-canvas outline-none lg:max-h-full lg:max-w-2xl lg:rounded-2xl lg:shadow-2xl"
      >
        <div
          className="flex shrink-0 items-center justify-between border-b border-line/60 py-2"
          style={{
            paddingTop: "max(8px, env(safe-area-inset-top, 0px))",
            paddingLeft: "max(16px, env(safe-area-inset-left, 0px))",
            paddingRight: "max(12px, env(safe-area-inset-right, 0px))",
          }}
        >
          <p className="min-w-0 truncate text-sm font-semibold">{label}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-subtle hover:text-ink"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto pt-4 lg:px-8 lg:pb-8"
          style={{
            paddingBottom: "max(24px, env(safe-area-inset-bottom, 0px))",
            paddingLeft: "max(16px, env(safe-area-inset-left, 0px))",
            paddingRight: "max(16px, env(safe-area-inset-right, 0px))",
          }}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

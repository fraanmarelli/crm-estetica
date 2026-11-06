"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Ventana encima de la pantalla actual (en la compu); en el celular ocupa toda la pantalla.
// Se cierra con la ✕, con Esc, tocando afuera o con el botón atrás del navegador.
export function Modal({ children, label }: { children: React.ReactNode; label: string }) {
  const router = useRouter();
  const panel = useRef<HTMLDivElement>(null);
  const close = () => router.back();
  // Se monta en <body>: así no la achica ni la corre ningún contenedor de la pantalla (grilla, animación)
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.back();
    };
    document.addEventListener("keydown", onKey);
    // La pantalla de atrás no se mueve mientras la ventana está abierta
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [router, mounted]);

  if (!mounted) return null;
  return createPortal(
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-stretch justify-center bg-black/45 lg:items-start lg:px-6 lg:py-10"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="modal-panel relative w-full overflow-y-auto bg-canvas outline-none lg:max-h-full lg:max-w-4xl lg:rounded-2xl lg:shadow-2xl"
        style={{
          paddingTop: "max(16px, env(safe-area-inset-top, 0px))",
          paddingBottom: "max(24px, env(safe-area-inset-bottom, 0px))",
          paddingLeft: "max(16px, env(safe-area-inset-left, 0px))",
          paddingRight: "max(16px, env(safe-area-inset-right, 0px))",
        }}
      >
        <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-2 flex items-center justify-between bg-canvas/95 px-4 py-2 backdrop-blur lg:-mx-4">
          <button
            type="button"
            onClick={close}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink lg:hidden"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Volver
          </button>
          <button
            type="button"
            onClick={close}
            aria-label="Cerrar"
            className="ml-auto hidden h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-subtle hover:text-ink lg:flex"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="lg:px-4 lg:pb-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

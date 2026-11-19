"use client";

import { useCallback, useState } from "react";
import { Dialog } from "@/components/dialog";

// Un franquiciado (o una sede sin franquiciado) en la lista de Sucursales: al tocarlo se abre su ventana
export function FranchiseeDialog({
  label,
  title,
  note,
  children,
}: {
  label: string;
  title: string;
  /** Aviso corto al lado (ej. «2 funciones apagadas») */
  note?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full bg-subtle px-3 py-1 text-sm font-semibold hover:bg-line/60"
      >
        {label}
        {note && <span className="text-xs font-semibold text-warn">{note}</span>}
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-muted" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <Dialog open={open} onClose={close} label={title}>
        {children}
      </Dialog>
    </>
  );
}

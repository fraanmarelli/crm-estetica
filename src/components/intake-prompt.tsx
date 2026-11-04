"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createIntakeLink } from "@/app/(app)/actions";
import { SubmitButton } from "@/components/submit-button";

// Aviso al cobrar a una paciente que se cargó rápido (por teléfono) y todavía no completó su ficha
export function IntakePrompt({ patientId, firstName, volver }: { patientId: string; firstName: string; volver: string }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="intake-prompt-title"
      onClick={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div className="card w-full max-w-md space-y-4">
        <div className="space-y-1">
          <h2 id="intake-prompt-title">Antes de cobrar: completá la ficha de {firstName}</h2>
          <p className="text-sm text-muted">
            Reservó sin venir antes, así que faltan su DNI, sus datos y el consentimiento. Lleva un minuto y después
            volvés acá a cobrar.
          </p>
        </div>
        <div className="grid gap-2">
          <form action={createIntakeLink}>
            <input type="hidden" name="patient_id" value={patientId} />
            <input type="hidden" name="volver" value={volver} />
            <SubmitButton className="btn btn-primary w-full">Que la complete ella con el QR</SubmitButton>
          </form>
          <Link
            href={`/pacientes/${patientId}/completar?volver=${encodeURIComponent(volver)}#yo`}
            className="btn w-full"
          >
            La completo yo
          </Link>
          <button type="button" className="py-1 text-sm text-muted hover:text-ink" onClick={() => setOpen(false)}>
            Ahora no, cobrar igual
          </button>
        </div>
      </div>
    </div>
  );
}

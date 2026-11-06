"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addClinicalNote } from "@/app/(app)/actions";
import { SubmitButton } from "@/components/submit-button";
import type { ActionState } from "@/lib/types";

// «+ Nota» de la historia clínica: se abre ahí mismo, sin ir al turno. De una sesión o suelta.
export function NoteComposer({
  patientId,
  appointmentId = null,
  label = "+ Nota",
  placeholder = "Qué pasó, qué se indicó, próximo paso",
  primary = false,
}: {
  patientId: string;
  appointmentId?: string | null;
  label?: string;
  placeholder?: string;
  primary?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<ActionState, FormData>(addClinicalNote, null);
  const formRef = useRef<HTMLFormElement>(null);

  // Guardada: se limpia y se cierra
  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setOpen(false);
    }
  }, [state]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={primary ? "btn btn-sm" : "text-xs font-semibold text-brand hover:underline"}
      >
        {label}
      </button>
    );
  }

  return (
    <form ref={formRef} action={action} className="w-full space-y-2">
      <input type="hidden" name="patient_id" value={patientId} />
      {appointmentId && <input type="hidden" name="appointment_id" value={appointmentId} />}
      <textarea
        name="body"
        rows={3}
        maxLength={4000}
        required
        autoFocus
        placeholder={placeholder}
        className="input"
      />
      {state?.error && <p className="text-sm text-bad">{state.error}</p>}
      <div className="flex items-center justify-end gap-2">
        <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
          Cancelar
        </button>
        <SubmitButton className="btn btn-sm btn-primary">Guardar nota</SubmitButton>
      </div>
      <p className="text-xs text-muted">Las notas quedan con tu nombre y la hora, y no se editan.</p>
    </form>
  );
}

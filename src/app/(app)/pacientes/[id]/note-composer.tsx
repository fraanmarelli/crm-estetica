"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addClinicalNote } from "@/app/(app)/actions";
import { SubmitButton } from "@/components/submit-button";
import type { ActionState } from "@/lib/types";

// «+ Nota» de la historia clínica: uno solo, arriba. Se abre ahí mismo, sin ir al turno, y pregunta de qué
// sesión es (la última ya elegida) o si es general (un llamado, un mensaje).
export function NoteComposer({
  patientId,
  sessions,
  label = "+ Nota",
  placeholder = "Qué pasó, qué se indicó, próximo paso",
}: {
  patientId: string;
  sessions: { id: string; label: string }[];
  label?: string;
  placeholder?: string;
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
        className="btn btn-sm"
      >
        {label}
      </button>
    );
  }

  return (
    <form ref={formRef} action={action} className="card basis-full space-y-2">
      <input type="hidden" name="patient_id" value={patientId} />
      <div>
        <label className="label" htmlFor="note-session">
          ¿Sobre qué sesión?
        </label>
        <select id="note-session" name="appointment_id" defaultValue={sessions[0]?.id ?? ""} className="input">
          {sessions.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
          <option value="">General (un llamado, un mensaje, algo aparte)</option>
        </select>
      </div>
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

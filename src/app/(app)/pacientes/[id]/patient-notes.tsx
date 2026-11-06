"use client";

import { useActionState, useEffect, useState } from "react";
import { savePatientNotes } from "@/app/(app)/actions";
import { SubmitButton } from "@/components/submit-button";
import type { ActionState } from "@/lib/types";

// «Para tener en cuenta»: lo que todo el equipo tiene que saber de la paciente (no datos de salud).
// Franja arriba de la ficha; también se ve en la agenda y en el turno.
export function PatientNotes({ patientId, notes, canEdit }: { patientId: string; notes: string | null; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [state, action] = useActionState<ActionState, FormData>(savePatientNotes, null);

  useEffect(() => {
    if (state?.ok) setEditing(false);
  }, [state]);

  if (editing) {
    return (
      <form action={action} className="space-y-2 rounded-xl border border-warn-line bg-warn-soft p-3">
        <input type="hidden" name="patient_id" value={patientId} />
        <label className="text-xs font-semibold text-warn" htmlFor="patient-notes">
          Para tener en cuenta
        </label>
        <textarea
          id="patient-notes"
          name="notes"
          rows={2}
          maxLength={1000}
          autoFocus
          defaultValue={notes ?? ""}
          placeholder="Ej. prefiere que le escriban a la tarde, viene con la hija"
          className="input"
        />
        {state?.error && <p className="text-sm text-bad">{state.error}</p>}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted">Lo ve todo el equipo. Lo de salud va en la historia clínica.</span>
          <div className="flex gap-2">
            <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>
              Cancelar
            </button>
            <SubmitButton className="btn btn-sm btn-primary">Guardar</SubmitButton>
          </div>
        </div>
      </form>
    );
  }

  if (!notes) {
    return canEdit ? (
      <button type="button" onClick={() => setEditing(true)} className="text-xs font-semibold text-muted hover:text-ink">
        + Para tener en cuenta
      </button>
    ) : null;
  }

  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-warn-line bg-warn-soft px-3.5 py-2.5 text-sm">
      <p className="min-w-0 whitespace-pre-line">
        <span className="font-semibold text-warn">Para tener en cuenta: </span>
        {notes}
      </p>
      {canEdit && (
        <button type="button" onClick={() => setEditing(true)} className="shrink-0 text-xs font-semibold text-warn hover:underline">
          Editar
        </button>
      )}
    </div>
  );
}

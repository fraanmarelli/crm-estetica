"use client";

import { useActionState, useEffect, useState } from "react";
import { saveClinicalBackground } from "@/app/(app)/actions";
import { SubmitButton } from "@/components/submit-button";
import type { ActionState } from "@/lib/types";

export type Background = {
  allergies: string | null;
  medications: string | null;
  conditions: string | null;
  previous_treatments: string | null;
  updated_by_name: string | null;
  updated_at: string | null;
};

const FIELDS: { key: keyof Background; label: string; placeholder: string }[] = [
  { key: "allergies", label: "Alergias", placeholder: "Ej. lidocaína, látex. Si no tiene, «Ninguna»" },
  { key: "medications", label: "Medicación", placeholder: "Ej. anticoagulantes, isotretinoína" },
  { key: "conditions", label: "Condiciones", placeholder: "Ej. embarazo, autoinmune, herpes recurrente" },
  { key: "previous_treatments", label: "Tratamientos previos", placeholder: "Ej. hilos 2024, rellenos en otra clínica" },
];

// «Ninguna», «no», «no tiene»: cargado, pero sin nada que avisar
const isNone = (v: string | null) => !!v && /^(ninguna?|no|no tiene|sin)\b/i.test(v.trim());

// Salud (antecedentes): lo primero que mira la profesional antes de atender. Solo se muestra lo cargado;
// una alergia va resaltada, y si no tiene ninguna lo dice en una línea.
export function ClinicalBackground({ patientId, data }: { patientId: string; data: Background | null }) {
  const [editing, setEditing] = useState(false);
  const [state, action] = useActionState<ActionState, FormData>(saveClinicalBackground, null);

  useEffect(() => {
    if (state?.ok) setEditing(false);
  }, [state]);

  if (editing) {
    return (
      <form action={action} className="space-y-3">
        <input type="hidden" name="patient_id" value={patientId} />
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label className="label" htmlFor={`bg-${f.key}`}>
              {f.label}
            </label>
            <textarea
              id={`bg-${f.key}`}
              name={f.key}
              rows={2}
              maxLength={1000}
              defaultValue={(data?.[f.key] as string | null) ?? ""}
              placeholder={f.placeholder}
              className="input"
            />
          </div>
        ))}
        {state?.error && <p className="text-sm text-bad">{state.error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>
            Cancelar
          </button>
          <SubmitButton className="btn btn-sm btn-primary">Guardar</SubmitButton>
        </div>
      </form>
    );
  }

  const filled = FIELDS.filter((f) => data?.[f.key]);
  const allergy = data?.allergies ?? null;
  const others = filled.filter((f) => f.key !== "allergies" && !isNone(data?.[f.key] as string | null));

  if (filled.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">Todavía no se cargaron alergias, medicación ni condiciones.</p>
        <button type="button" onClick={() => setEditing(true)} className="btn btn-sm">
          Cargar antecedentes
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {allergy && !isNone(allergy) ? (
        <p className="inline-flex max-w-full items-baseline gap-2 rounded-lg bg-bad-soft px-2.5 py-1.5 text-sm text-bad">
          <span className="shrink-0 font-semibold">Alergia</span>
          <span className="min-w-0 whitespace-pre-line font-semibold">{allergy}</span>
        </p>
      ) : (
        <p className="text-sm text-ok">{allergy ? "Sin alergias" : "Alergias sin cargar"}</p>
      )}
      {others.length > 0 && (
        <dl className="space-y-1.5 text-sm">
          {others.map((f) => (
            <div key={f.key}>
              <dt className="text-xs text-muted">{f.label}</dt>
              <dd className="whitespace-pre-line">{data?.[f.key] as string}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span>
          {data?.updated_at
            ? `Actualizado el ${new Date(data.updated_at).toLocaleDateString("es-AR", {
                timeZone: "America/Argentina/Buenos_Aires",
                day: "numeric",
                month: "numeric",
              })}${data.updated_by_name ? ` por ${data.updated_by_name}` : ""}`
            : ""}
        </span>
        <button type="button" onClick={() => setEditing(true)} className="font-semibold hover:text-ink">
          Editar
        </button>
      </div>
    </div>
  );
}

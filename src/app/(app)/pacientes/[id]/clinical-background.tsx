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

// Antecedentes: fijo arriba de la historia clínica. Lo primero que mira la profesional antes de atender.
export function ClinicalBackground({ patientId, data }: { patientId: string; data: Background | null }) {
  const [editing, setEditing] = useState(false);
  const [state, action] = useActionState<ActionState, FormData>(saveClinicalBackground, null);

  useEffect(() => {
    if (state?.ok) setEditing(false);
  }, [state]);

  const empty = !data || FIELDS.every((f) => !data[f.key]);

  if (editing) {
    return (
      <form action={action} className="card space-y-3">
        <input type="hidden" name="patient_id" value={patientId} />
        <h3 className="text-sm font-semibold">Antecedentes</h3>
        <div className="grid gap-3 sm:grid-cols-2">
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
        </div>
        {state?.error && <p className="text-sm text-bad">{state.error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>
            Cancelar
          </button>
          <SubmitButton className="btn btn-sm btn-primary">Guardar antecedentes</SubmitButton>
        </div>
      </form>
    );
  }

  if (empty) {
    return (
      <div className="card flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted">Sin antecedentes cargados (alergias, medicación, condiciones).</span>
        <button type="button" onClick={() => setEditing(true)} className="btn btn-sm">
          Cargar antecedentes
        </button>
      </div>
    );
  }

  return (
    <div className="card space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Antecedentes</h3>
        <button type="button" onClick={() => setEditing(true)} className="text-xs font-semibold text-brand hover:underline">
          Editar
        </button>
      </div>
      <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        {FIELDS.map((f) => {
          const v = data?.[f.key] as string | null;
          const alert = f.key === "allergies" && v && !/^(ninguna|no)\b/i.test(v.trim());
          return (
            <div key={f.key} className="min-w-0">
              <dt className="text-xs text-muted">{f.label}</dt>
              <dd className={`whitespace-pre-line ${alert ? "font-semibold text-bad" : v ? "" : "text-muted"}`}>{v || "—"}</dd>
            </div>
          );
        })}
      </dl>
      {data?.updated_at && (
        <p className="text-xs text-muted">
          Actualizado por {data.updated_by_name ?? "el equipo"} el{" "}
          {new Date(data.updated_at).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}
        </p>
      )}
    </div>
  );
}

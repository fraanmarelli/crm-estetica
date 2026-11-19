"use client";

import { useActionState, useState } from "react";
import { saveRecallSettings } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { fillTemplate } from "@/lib/format";
import type { ActionState } from "@/lib/types";

export type RecallRow = {
  id: string;
  name: string;
  category: string | null;
  catalog_days: number | null; // lo de la marca
  days: number | null; // lo que vale en esta sucursal (null = sin recall)
};

const VARIABLES = ["{nombre}", "{tratamiento}", "{meses}", "{sucursal}"];

// «120» → «unos 4 meses»
function aboutMonths(days: string) {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 45) return n === 1 ? "1 día" : `${n} días`;
  const m = Math.round(n / 30.4);
  return m >= 12 && m % 12 === 0 ? (m === 12 ? "1 año" : `${m / 12} años`) : `unos ${m} meses`;
}

export function RecallForm({
  rows: initial,
  message: initialMessage,
  defaultMessage,
  branchLabel,
}: {
  rows: RecallRow[];
  message: string;
  defaultMessage: string;
  branchLabel: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(saveRecallSettings, null);
  const [message, setMessage] = useState(initialMessage);
  const [rows, setRows] = useState(initial.map((r) => ({ ...r, value: r.days == null ? "" : String(r.days) })));

  const example = rows.find((r) => r.value) ?? rows[0];
  const preview = fillTemplate(message.trim() || defaultMessage, {
    nombre: "Sofía",
    sucursal: branchLabel,
    meses: example?.value ? String(Math.max(1, Math.round(Number(example.value) / 30.4))) : "4",
    tratamiento: example?.name ?? "Botox",
  });

  return (
    <form action={action} className="space-y-5">
      <input
        type="hidden"
        name="days"
        value={JSON.stringify(rows.map((r) => ({ treatment_id: r.id, days: r.value.trim() })))}
      />

      <div className="space-y-2">
        <label htmlFor="recall_message" className="label">
          Mensaje de WhatsApp
        </label>
        <textarea
          id="recall_message"
          name="message"
          rows={3}
          value={message}
          placeholder={defaultMessage}
          onChange={(e) => setMessage(e.target.value)}
          className="input"
        />
        <p className="text-xs text-muted">
          Se completan solos: {VARIABLES.join(" ")}. Vacío = el mensaje de siempre.
        </p>
        <p className="rounded-xl bg-subtle px-3 py-2 text-sm">
          <span className="text-muted">Así le llega: </span>
          {preview}
        </p>
      </div>

      <div className="space-y-2">
        <p className="label">Cada cuánto le toca volver</p>
        <p className="text-xs text-muted">
          Días desde el último tratamiento. Vacío = ese tratamiento no aparece en Recall.
        </p>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="table">
            <thead>
              <tr>
                <th>Tratamiento</th>
                <th className="w-28">Días</th>
                <th className="hidden sm:table-cell" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const changed = (r.value.trim() === "" ? null : Number(r.value)) !== r.catalog_days;
                return (
                  <tr key={r.id}>
                    <td>
                      <p>{r.name}</p>
                      {changed && (
                        <p className="text-xs text-muted">
                          La marca sugiere {r.catalog_days ? `${r.catalog_days} días` : "sin recall"}
                        </p>
                      )}
                    </td>
                    <td>
                      <input
                        value={r.value}
                        onChange={(e) =>
                          setRows((s) =>
                            s.map((x, j) => (j === i ? { ...x, value: e.target.value.replace(/\D/g, "").slice(0, 4) } : x)),
                          )
                        }
                        inputMode="numeric"
                        placeholder="—"
                        aria-label={`Días de recall de ${r.name}`}
                        className="input num"
                      />
                    </td>
                    <td className="hidden text-sm text-muted sm:table-cell">{aboutMonths(r.value)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {state?.error && <p className="alert-error">{state.error}</p>}
      {state?.ok && <p className="alert-ok">{state.ok}</p>}
      <div className="flex justify-end">
        <SubmitButton pendingText="Guardando...">Guardar recall</SubmitButton>
      </div>
    </form>
  );
}

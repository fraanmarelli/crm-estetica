"use client";

import { useActionState, useState } from "react";
import { saveSupplyCosts } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { groupThousands, moneyInputValue, pluralEs } from "@/lib/format";
import type { ActionState, Supply } from "@/lib/types";

const money = (v: number | null) =>
  v === null ? "Sin cargar" : v.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export function SupplyCostsForm({ supplies, canEdit }: { supplies: Supply[]; canEdit: boolean }) {
  const [state, action] = useActionState<ActionState, FormData>(saveSupplyCosts, null);
  const [values, setValues] = useState(() =>
    Object.fromEntries(supplies.map((s) => [s.id, { unit_cost: moneyInputValue(s.unit_cost), unit: s.unit }])),
  );
  const rows = JSON.stringify(Object.entries(values).map(([id, v]) => ({ id, ...v })));
  const missing = supplies.filter((s) => s.unit_cost === null).length;

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="rows" value={rows} />
      {missing > 0 && (
        <p className="text-sm text-warn">
          {missing} {missing === 1 ? "insumo" : "insumos"} sin costo: los turnos que los usen no van a calcular margen.
        </p>
      )}
      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr>
              <th>Insumo</th>
              <th className="w-40">Se vende por</th>
              <th className="w-44">Costo para la franquicia</th>
            </tr>
          </thead>
          <tbody>
            {supplies.map((s) => (
              <tr key={s.id}>
                <td className="font-medium">{s.name}</td>
                <td>
                  {canEdit ? (
                    <input
                      value={values[s.id].unit}
                      onChange={(e) => setValues((v) => ({ ...v, [s.id]: { ...v[s.id], unit: e.target.value } }))}
                      aria-label={`Unidad de ${s.name}`}
                      className="input"
                    />
                  ) : (
                    s.unit
                  )}
                </td>
                <td>
                  {canEdit ? (
                    <input
                      inputMode="numeric"
                      value={values[s.id].unit_cost}
                      onChange={(e) => setValues((v) => ({ ...v, [s.id]: { ...v[s.id], unit_cost: groupThousands(e.target.value) } }))}
                      placeholder={`$ por ${s.unit}`}
                      aria-label={`Costo de ${s.name}`}
                      className="input num"
                    />
                  ) : (
                    <span className="num">
                      {money(s.unit_cost)}
                      {s.unit_cost !== null && <span className="text-muted"> por {s.unit}</span>}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {state?.error && <p className="alert-error">{state.error}</p>}
      {state?.ok && <p className="alert-ok">{state.ok}</p>}
      {canEdit && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted">
            Ejemplo: toxina a $1.800 por unidad; un botox de 50 {pluralEs("unidad")} cuesta $90.000.
          </p>
          <SubmitButton>Guardar costos</SubmitButton>
        </div>
      )}
    </form>
  );
}

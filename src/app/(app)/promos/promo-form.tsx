"use client";

import { useActionState, useMemo, useState } from "react";
import { createPromotion } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { DateField } from "@/components/date-fields";
import { MoneyInput } from "@/components/money-input";
import type { ActionState } from "@/lib/types";

type TreatmentOption = { id: string; name: string; category: string | null };
type Row = { treatment_id: string; zone: string };

const emptyRow = (): Row => ({ treatment_id: "", zone: "" });

export function PromoForm({
  treatments,
  isNetwork,
  branchName,
}: {
  treatments: TreatmentOption[];
  isNetwork: boolean;
  branchName: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(createPromotion, null);
  // Al crearla bien se vacía el formulario (cambia la key)
  return <PromoFormInner key={state?.ok ?? "new"} {...{ treatments, isNetwork, branchName, state, action }} />;
}

function PromoFormInner({
  treatments,
  isNetwork,
  branchName,
  state,
  action,
}: {
  treatments: TreatmentOption[];
  isNetwork: boolean;
  branchName: string;
  state: ActionState;
  action: (fd: FormData) => void;
}) {
  const v = state?.error ? (state.values ?? {}) : {};
  const [rows, setRows] = useState<Row[]>(() => {
    try {
      const prev = JSON.parse(v.items ?? "[]") as Row[];
      return prev.length ? prev : [emptyRow()];
    } catch {
      return [emptyRow()];
    }
  });

  const byCategory = useMemo(() => {
    const groups = new Map<string, TreatmentOption[]>();
    for (const t of treatments) {
      const key = t.category ?? "Otros";
      groups.set(key, [...(groups.get(key) ?? []), t]);
    }
    return [...groups.entries()];
  }, [treatments]);

  const filled = rows.filter((r) => r.treatment_id).length;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="items" value={JSON.stringify(rows)} />
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem_10rem]">
        <div>
          <label className="label" htmlFor="promo-name">Nombre</label>
          <input
            id="promo-name"
            name="name"
            required
            defaultValue={v.name}
            placeholder="Ej. Combo Botox + Hilos"
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="promo-price">Precio total</label>
          <MoneyInput id="promo-price" name="price" required defaultValue={v.price} placeholder="$" />
        </div>
        <div>
          <label className="label" htmlFor="promo-until">Vence (opcional)</label>
          <DateField id="promo-until" name="valid_until" defaultValue={v.valid_until} />
        </div>
      </div>

      {isNetwork && (
        <fieldset className="flex flex-wrap gap-4 text-sm">
          <legend className="label">Para quién</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="scope" value="network" defaultChecked={v.scope !== "branch"} />
            Toda la red
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="scope" value="branch" defaultChecked={v.scope === "branch"} />
            Solo {branchName}
          </label>
        </fieldset>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="label mb-0">Tratamientos incluidos</span>
          <button type="button" className="btn btn-sm" onClick={() => setRows((r) => [...r, emptyRow()])}>
            Sumar tratamiento
          </button>
        </div>
        {rows.map((row, index) => (
          <div key={index} className="grid gap-2 rounded-xl bg-subtle p-2 sm:grid-cols-[2fr_1fr_auto]">
            <select
              value={row.treatment_id}
              onChange={(e) =>
                setRows((r) => r.map((x, i) => (i === index ? { ...x, treatment_id: e.target.value } : x)))
              }
              aria-label="Tratamiento"
              className="input"
            >
              <option value="">Elegí un tratamiento</option>
              {byCategory.map(([category, list]) => (
                <optgroup key={category} label={category}>
                  {list.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <input
              value={row.zone}
              onChange={(e) => setRows((r) => r.map((x, i) => (i === index ? { ...x, zone: e.target.value } : x)))}
              placeholder="Zona (opcional)"
              aria-label="Zona"
              className="input"
            />
            <button
              type="button"
              className="btn"
              aria-label="Quitar tratamiento"
              onClick={() => setRows((r) => (r.length === 1 ? [emptyRow()] : r.filter((_, i) => i !== index)))}
            >
              ✕
            </button>
          </div>
        ))}
        <p className="text-xs text-muted">
          {filled > 1
            ? "Es un combo: al aplicarla en un turno, el precio total se reparte entre los tratamientos y se puede ajustar."
            : "Con un solo tratamiento es un precio fijo. Sumá otro para armar un combo."}
        </p>
      </div>

      {state?.error && <p className="alert-error">{state.error}</p>}
      {state?.ok && <p className="alert-ok">{state.ok}</p>}
      <div className="flex justify-end">
        <SubmitButton>Crear promo</SubmitButton>
      </div>
    </form>
  );
}

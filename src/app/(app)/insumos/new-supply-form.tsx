"use client";

import { useActionState } from "react";
import { createSupply } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import type { ActionState } from "@/lib/types";

export function NewSupplyForm() {
  const [state, action] = useActionState<ActionState, FormData>(createSupply, null);
  return (
    <form key={state?.ok ?? "new"} action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_9rem_10rem]">
        <div>
          <label className="label" htmlFor="supply-name">Nombre</label>
          <input id="supply-name" name="name" required placeholder="Ej. Bioestimulador X" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="supply-unit">Se vende por</label>
          <input id="supply-unit" name="unit" placeholder="unidad, ml, vial" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="supply-cost">Costo</label>
          <input id="supply-cost" name="unit_cost" inputMode="numeric" placeholder="$" className="input" />
        </div>
      </div>
      {state?.error && <p className="alert-error">{state.error}</p>}
      {state?.ok && <p className="alert-ok">{state.ok}</p>}
      <div className="flex justify-end">
        <SubmitButton>Agregar insumo</SubmitButton>
      </div>
    </form>
  );
}

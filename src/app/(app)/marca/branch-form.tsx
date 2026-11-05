"use client";

import { useActionState } from "react";
import { createBranch } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import type { ActionState } from "@/lib/types";

export function BranchForm() {
  const [state, action] = useActionState<ActionState, FormData>(createBranch, null);
  return (
    <form key={state?.ok ?? "branch"} action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_1.5fr]">
        <div>
          <label className="label" htmlFor="br-name">Nombre</label>
          <input id="br-name" name="name" required placeholder="Ej. Rosario" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="br-address">Dirección (opcional)</label>
          <input id="br-address" name="address" className="input" />
        </div>
      </div>
      {state?.error && <p className="alert-error">{state.error}</p>}
      {state?.ok && <p className="alert-ok">{state.ok}</p>}
      <div className="flex justify-end">
        <SubmitButton className="btn">Crear sucursal</SubmitButton>
      </div>
    </form>
  );
}

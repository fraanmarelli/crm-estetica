"use client";

import { useActionState } from "react";
import { createIntegration } from "../actions";
import { SubmitButton } from "@/components/submit-button";
import type { ActionState, Branch } from "@/lib/types";

export function IntegrationForm({ branches }: { branches: Branch[] }) {
  const [state, action] = useActionState<ActionState, FormData>(createIntegration, null);
  const v = state?.ok ? {} : (state?.values ?? {});

  return (
    <form key={JSON.stringify(state)} action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Nombre</label>
          <input name="name" defaultValue={v.name ?? "Planilla de turnos"} className="input" />
        </div>
        <div>
          <label className="label">Sucursal</label>
          <select name="branch_id" defaultValue={v.branch_id ?? ""} className="input">
            <option value="">Todas las sucursales</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="label">URL de la aplicación web (Apps Script)</label>
        <input
          name="url"
          required
          defaultValue={v.url}
          placeholder="https://script.google.com/macros/s/.../exec"
          className="input"
        />
      </div>
      <div>
        <label className="label">Token (el mismo que pusiste en CONFIG.TOKEN del script)</label>
        <input name="secret" required defaultValue={v.secret} className="input" />
      </div>
      {state?.error && <p className="alert-error">{state.error}</p>}
      {state?.ok && <p className="alert-ok">{state.ok}</p>}
      <div className="flex justify-end">
        <SubmitButton>Conectar planilla</SubmitButton>
      </div>
    </form>
  );
}

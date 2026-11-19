"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { FEATURE_KEYS, FEATURE_LABEL, type Features } from "@/lib/feature-labels";
import { setBranchFeatures } from "./actions";

// Interruptores de las funciones de una sede (solo la marca)
export function FeaturesForm({ branchId, branchName, features }: { branchId: string; branchName: string; features: Features }) {
  const [state, action] = useActionState(setBranchFeatures, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="branch_id" value={branchId} />
      <ul className="divide-y divide-line rounded-xl bg-surface">
        {FEATURE_KEYS.map((k) => (
          <li key={k}>
            <label className="flex cursor-pointer items-start justify-between gap-4 px-4 py-3">
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{FEATURE_LABEL[k].title}</span>
                <span className="block text-xs text-muted">{FEATURE_LABEL[k].detail}</span>
              </span>
              <input type="checkbox" name={`on_${k}`} defaultChecked={features[k]} className="switch mt-0.5 shrink-0" />
            </label>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">
        Una función apagada desaparece para todo el equipo de {branchName} y deja de funcionar sola (sincronizar anuncios,
        verificar transferencias, mandar a la planilla). Lo que ya está cargado queda guardado: si la volvés a prender,
        aparece como estaba.
      </p>
      {state?.error && <p className="alert-error">{state.error}</p>}
      {state?.ok && <p className="alert-ok">{state.ok}</p>}
      <div className="flex justify-end">
        <SubmitButton pendingText="Guardando...">Guardar funciones</SubmitButton>
      </div>
    </form>
  );
}

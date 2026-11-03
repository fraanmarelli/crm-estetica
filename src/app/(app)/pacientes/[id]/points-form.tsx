"use client";

import { useActionState } from "react";
import { adjustPoints } from "../../actions";
import { SubmitButton } from "@/components/submit-button";
import type { ActionState } from "@/lib/types";

export function PointsForm({ patientId }: { patientId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(adjustPoints, null);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="patient_id" value={patientId} />
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <select name="mode" className="input w-auto" defaultValue="redeem">
          <option value="redeem">Canjear</option>
          <option value="add">Sumar</option>
        </select>
        <input name="points" type="number" min={1} placeholder="Millas" required className="input" />
      </div>
      <input name="reason" placeholder="Motivo (ej. canje por Botox)" required className="input" />
      {state?.error && <p className="alert-error">{state.error}</p>}
      {state?.ok && <p className="alert-ok">{state.ok}</p>}
      <SubmitButton className="btn w-full">Registrar</SubmitButton>
    </form>
  );
}

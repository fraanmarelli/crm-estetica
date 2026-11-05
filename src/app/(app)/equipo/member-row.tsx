"use client";

import { useActionState, useState } from "react";
import { removeMember, type RemoveState } from "./actions";

// "Quitar acceso" con confirmación en la misma fila
export function RemoveMemberButton({ id, email }: { id: string; email: string }) {
  const [state, action, pending] = useActionState<RemoveState, FormData>(removeMember, null);
  const [confirming, setConfirming] = useState(false);
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="id" value={id} />
      {confirming ? (
        <>
          <span className="text-xs text-bad">¿Sacarle el acceso a {email}?</span>
          <button type="submit" disabled={pending} className="btn btn-sm">
            {pending ? "Quitando..." : "Sí, quitar"}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setConfirming(false)}>
            No
          </button>
        </>
      ) : (
        <button type="button" className="text-xs text-muted hover:text-bad" onClick={() => setConfirming(true)}>
          Quitar acceso
        </button>
      )}
      {state?.error && <span className="w-full text-right text-xs text-bad">{state.error}</span>}
    </form>
  );
}

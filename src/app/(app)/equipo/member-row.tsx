"use client";

import { useActionState, useState } from "react";
import { CopyLink } from "@/app/(app)/pacientes/registro/client-bits";
import { SubmitButton } from "@/components/submit-button";
import { createResetLink, removeMember, type RemoveState, type ResetLinkState } from "./actions";

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

// «Link para nueva contraseña»: para quien se olvidó la suya. Se manda por WhatsApp como la invitación.
export function ResetLinkButton({
  membershipId,
  branchId,
  orgName,
}: {
  membershipId: string;
  branchId: string | null;
  orgName: string;
}) {
  const [state, action] = useActionState<ResetLinkState, FormData>(createResetLink, null);
  const message = state?.link
    ? `Hola! Entrá a este link para elegir tu nueva contraseña del CRM de ${orgName}: ${state.link} (vence en 1 hora y sirve una sola vez)`
    : "";
  return (
    <div className="basis-full sm:basis-auto">
      <form action={action} className="flex justify-end">
        <input type="hidden" name="membership_id" value={membershipId} />
        <input type="hidden" name="branch_id" value={branchId ?? ""} />
        <SubmitButton className="text-xs text-muted hover:text-ink" pendingText="Generando...">
          Link para nueva contraseña
        </SubmitButton>
      </form>
      {state?.error && <p className="mt-1 text-right text-xs text-bad">{state.error}</p>}
      {state?.link && (
        <div className="mt-2 space-y-2 rounded-xl bg-subtle p-3 text-sm">
          <p className="font-semibold">Link para {state.email}</p>
          <div className="flex flex-wrap gap-2">
            <a
              href={`https://wa.me/?text=${encodeURIComponent(message)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-sm btn-primary"
            >
              Mandar por WhatsApp
            </a>
            <CopyLink url={state.link} />
          </div>
          <p className="text-xs text-muted">Vence en 1 hora y sirve una sola vez. Mandalo solo a esa persona.</p>
        </div>
      )}
    </div>
  );
}

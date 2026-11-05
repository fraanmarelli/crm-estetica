"use client";

import { useActionState, useState } from "react";
import { disconnectLeadPage, reimportLeads, type LeadPageState } from "./actions";

// Acciones de la página de Facebook conectada: volver a importar y desconectar (con confirmación)
export function LeadPageActions({ id, name }: { id: string; name: string }) {
  const [importState, importAction, importing] = useActionState<LeadPageState, FormData>(reimportLeads, null);
  const [disconnectState, disconnectAction, disconnecting] = useActionState<LeadPageState, FormData>(
    disconnectLeadPage,
    null,
  );
  const [confirming, setConfirming] = useState(false);
  const error = importState?.error ?? disconnectState?.error;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {confirming ? (
        <form action={disconnectAction} className="flex flex-wrap items-center justify-end gap-2">
          <input type="hidden" name="id" value={id} />
          <span className="text-xs text-bad">¿Desconectar «{name}»? Dejan de llegar leads nuevos.</span>
          <button type="submit" disabled={disconnecting} className="btn btn-sm">
            {disconnecting ? "Desconectando..." : "Sí, desconectar"}
          </button>
          <button type="button" className="btn btn-sm" disabled={disconnecting} onClick={() => setConfirming(false)}>
            No
          </button>
        </form>
      ) : (
        <>
          <form action={importAction}>
            <input type="hidden" name="id" value={id} />
            <button type="submit" disabled={importing} className="btn btn-sm">
              {importing ? "Buscando en Meta..." : "Volver a importar"}
            </button>
          </form>
          <button
            type="button"
            disabled={importing}
            className="text-xs text-muted hover:text-bad"
            onClick={() => setConfirming(true)}
          >
            Desconectar
          </button>
        </>
      )}
      {error && <span className="w-full text-right text-xs text-bad">{error}</span>}
    </div>
  );
}

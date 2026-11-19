"use client";

import { useActionState, useState } from "react";
import { cancelInvoice } from "../actions";
import { SubmitButton } from "@/components/submit-button";
import type { ActionState } from "@/lib/types";

// En el celular abre «Compartir» con el PDF (WhatsApp, mail…); en la compu lo descarga
export function SharePdfButton({ url, fileName }: { url: string; fileName: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const safeName = fileName.normalize("NFD").replace(/[̀-ͯ]/g, "");

  async function share() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const file = new File([blob], safeName, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: safeName });
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = safeName;
        a.click();
        URL.revokeObjectURL(a.href);
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") setMsg("No se pudo compartir. Usá «Ver PDF» y descargalo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={share} disabled={busy} className="btn">
        {busy ? "Preparando..." : "Compartir o descargar"}
      </button>
      {msg && <p className="text-xs text-bad">{msg}</p>}
    </div>
  );
}

export function CancelInvoiceForm({ invoiceId, label, total }: { invoiceId: string; label: string; total: string }) {
  const [state, action] = useActionState<ActionState, FormData>(cancelInvoice, null);
  return (
    <details className="card">
      <summary className="cursor-pointer font-semibold">Anular esta factura</summary>
      <form action={action} className="mt-3 space-y-3">
        <input type="hidden" name="invoice_id" value={invoiceId} />
        <p className="text-sm text-muted">
          En ARCA una factura no se borra: se emite una nota de crédito C por {total} asociada a la {label}. Queda en el
          historial y resta de lo facturado.
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="confirm" className="mt-0.5" />
          Sí, emitir la nota de crédito por {total}.
        </label>
        {state?.error && <p className="alert-error">{state.error}</p>}
        <SubmitButton pendingText="Emitiendo nota de crédito..." className="btn text-bad">
          Anular con nota de crédito
        </SubmitButton>
      </form>
    </details>
  );
}

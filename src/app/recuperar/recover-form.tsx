"use client";

import Link from "next/link";
import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { requestPasswordReset } from "./actions";

export function RecoverForm({ expired }: { expired: boolean }) {
  const [state, action] = useActionState(requestPasswordReset, null);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      <div className="card w-full max-w-sm space-y-4 p-6">
        {state?.ok ? (
          <>
            <h1>Revisá tu mail</h1>
            <p className="text-sm">
              Si <b>{state.ok}</b> tiene cuenta en el CRM, te llegó un mail con un link para elegir una contraseña nueva.
              El link sirve una sola vez y vence en una hora. Si no lo ves, buscá en spam.
            </p>
            <p className="text-sm text-muted">
              ¿No te llega? Pedile a tu franquiciado (o a la marca) un link desde Ajustes → Equipo → «Link para nueva
              contraseña», y te lo manda por WhatsApp.
            </p>
            <Link href="/login" className="btn w-full">Volver a ingresar</Link>
          </>
        ) : (
          <form action={action} className="space-y-4">
            <div>
              <h1>Recuperar contraseña</h1>
              <p className="mt-1 text-sm text-muted">Te mandamos un link a tu mail para elegir una nueva.</p>
            </div>
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" name="email" type="email" autoComplete="email" required autoFocus className="input" />
            </div>
            {expired && !state?.error && (
              <p className="alert-error">Ese link ya se usó o venció. Pedí uno nuevo acá abajo.</p>
            )}
            {state?.error && <p className="alert-error">{state.error}</p>}
            <SubmitButton className="btn btn-primary w-full" pendingText="Enviando...">
              Mandarme el link
            </SubmitButton>
            <p className="text-center text-sm">
              <Link href="/login" className="text-muted hover:text-ink">Volver a ingresar</Link>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}

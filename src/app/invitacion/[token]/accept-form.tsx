"use client";

import Link from "next/link";
import { useActionState } from "react";
import { acceptInvite, type AcceptState } from "./actions";
import { SubmitButton } from "@/components/submit-button";

export function AcceptForm({ token, email, hasAccount }: { token: string; email: string; hasAccount: boolean }) {
  const [state, action] = useActionState<AcceptState, FormData>(acceptInvite, null);

  if (state?.done) {
    return (
      <div className="card space-y-3 text-center">
        <p>{state.done}</p>
        <Link href="/login" className="btn btn-primary">Ir a iniciar sesión</Link>
      </div>
    );
  }

  return (
    <form action={action} className="card space-y-4">
      <input type="hidden" name="token" value={token} />
      <div>
        <label className="label">Tu usuario</label>
        <p className="input bg-subtle text-muted">{email}</p>
      </div>
      {hasAccount ? (
        <p className="text-sm text-muted">Ya tenés una cuenta con este mail: el acceso nuevo se suma a tu usuario.</p>
      ) : (
        <>
          <div>
            <label className="label" htmlFor="inv-pass">Elegí tu contraseña</label>
            <input id="inv-pass" name="password" type="password" required minLength={8} autoComplete="new-password" className="input py-3 text-base" />
            <p className="mt-1 text-xs text-muted">Al menos 8 caracteres.</p>
          </div>
          <div>
            <label className="label" htmlFor="inv-pass2">Repetila</label>
            <input id="inv-pass2" name="password2" type="password" required minLength={8} autoComplete="new-password" className="input py-3 text-base" />
          </div>
        </>
      )}
      {state?.error && <p className="alert-error">{state.error}</p>}
      <SubmitButton className="btn btn-primary w-full py-3 text-base">
        {hasAccount ? "Aceptar invitación" : "Crear mi acceso y entrar"}
      </SubmitButton>
    </form>
  );
}

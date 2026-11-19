"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { setNewPassword } from "./actions";

export default function NewPasswordPage() {
  const [state, action] = useActionState(setNewPassword, null);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      <form action={action} className="card w-full max-w-sm space-y-4 p-6">
        <div>
          <h1>Contraseña nueva</h1>
          <p className="mt-1 text-sm text-muted">Al menos 8 caracteres. Después entrás directo.</p>
        </div>
        <div>
          <label className="label" htmlFor="password">Contraseña nueva</label>
          <input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required autoFocus className="input" />
        </div>
        <div>
          <label className="label" htmlFor="password2">Repetila</label>
          <input id="password2" name="password2" type="password" autoComplete="new-password" minLength={8} required className="input" />
        </div>
        {state?.error && <p className="alert-error">{state.error}</p>}
        <SubmitButton className="btn btn-primary w-full" pendingText="Guardando...">
          Guardar y entrar
        </SubmitButton>
      </form>
    </main>
  );
}

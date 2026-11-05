"use client";

import { useActionState } from "react";
import { signIn } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, null);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      <form action={action} className="card w-full max-w-sm space-y-4 p-6">
        <div>
          <h1>Ingresar</h1>
          <p className="mt-1 text-sm text-muted">CRM de la clínica</p>
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required className="input" />
        </div>
        <div>
          <label className="label" htmlFor="password">Contraseña</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
        </div>
        {state?.error && <p className="alert-error">{state.error}</p>}
        <button type="submit" disabled={pending} className="btn btn-primary w-full">
          {pending ? "Ingresando..." : "Ingresar"}
        </button>
      </form>
      <p className="flex gap-4 text-xs text-muted">
        <a href="/privacidad" className="hover:text-ink">Privacidad</a>
        <a href="/borrado-de-datos" className="hover:text-ink">Borrado de datos</a>
      </p>
    </main>
  );
}

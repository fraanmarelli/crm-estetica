"use client";

import { useActionState } from "react";
import { completeIntake, type IntakeState } from "./actions";
import { SubmitButton } from "@/components/submit-button";

export function IntakeForm({
  token,
  clinic,
  firstName,
  lastName,
  onClinicDevice,
}: {
  token: string;
  clinic: string;
  firstName: string;
  lastName: string;
  onClinicDevice: boolean;
}) {
  const [state, action] = useActionState<IntakeState, FormData>(completeIntake, null);
  const v = state?.values ?? { first_name: firstName, last_name: lastName };

  if (state?.done) {
    return (
      <div className="card space-y-3 text-center">
        <h1>¡Listo, {state.done}!</h1>
        <p className="text-muted">
          {onClinicDevice
            ? "Tu ficha quedó completa. Ya podés devolver el celular."
            : "Tu ficha quedó completa. Ya podés cerrar esta página. ¡Te esperamos!"}
        </p>
      </div>
    );
  }

  const field = "input py-3 text-base";
  return (
    <form key={JSON.stringify(v)} action={action} className="space-y-5">
      <input type="hidden" name="token" value={token} />
      <div className="card space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="i-nombre">Nombre *</label>
            <input id="i-nombre" name="first_name" required autoComplete="given-name" defaultValue={v.first_name} className={field} />
          </div>
          <div>
            <label className="label" htmlFor="i-apellido">Apellido</label>
            <input id="i-apellido" name="last_name" autoComplete="family-name" defaultValue={v.last_name} className={field} />
          </div>
          <div>
            <label className="label" htmlFor="i-dni">DNI</label>
            <input id="i-dni" name="dni" inputMode="numeric" defaultValue={v.dni} className={field} />
          </div>
          <div>
            <label className="label" htmlFor="i-nac">Fecha de nacimiento</label>
            <input id="i-nac" name="birth_date" type="date" autoComplete="bday" defaultValue={v.birth_date} className={field} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="i-mail">Email</label>
            <input id="i-mail" name="email" type="email" inputMode="email" autoComplete="email" defaultValue={v.email} className={field} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="i-dom">Domicilio</label>
            <input id="i-dom" name="address" autoComplete="street-address" defaultValue={v.address} className={field} />
          </div>
        </div>
      </div>

      <div className="card space-y-3 text-sm">
        <label className="flex items-start gap-3">
          <input type="checkbox" name="consent_data" required defaultChecked={v.consent_data === "on"} className="mt-0.5 h-5 w-5 shrink-0" />
          <span>
            Autorizo a {clinic} a guardar mis datos para mi atención y mis turnos (Ley 25.326). *
          </span>
        </label>
        <label className="flex items-start gap-3">
          <input type="checkbox" name="consent_marketing" defaultChecked={v.consent_marketing === "on"} className="mt-0.5 h-5 w-5 shrink-0" />
          <span>Quiero recibir recordatorios y novedades por WhatsApp y email.</span>
        </label>
      </div>

      {state?.error && <p className="alert-error">{state.error}</p>}
      <SubmitButton className="btn btn-primary w-full py-3 text-base">Completar mi ficha</SubmitButton>
    </form>
  );
}

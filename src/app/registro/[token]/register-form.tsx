"use client";

import { useActionState } from "react";
import { registerPatient, type RegisterState } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { DateField } from "@/components/date-fields";
import { PATIENT_SOURCES } from "@/lib/format";

export function RegisterForm({ token, clinic, onClinicDevice }: { token: string; clinic: string; onClinicDevice: boolean }) {
  const [state, action] = useActionState<RegisterState, FormData>(registerPatient, null);
  const v = state?.values ?? {};

  if (state?.done) {
    return (
      <div className="card space-y-4 text-center">
        <h1>¡Listo, {state.done}!</h1>
        {onClinicDevice ? (
          <>
            <p className="text-muted">Tus datos quedaron registrados. Ya podés devolver el celular.</p>
            {/* Celular del local: deja el formulario listo para la próxima paciente */}
            <button type="button" className="btn" onClick={() => window.location.reload()}>
              Registrar a otra persona
            </button>
          </>
        ) : (
          <p className="text-muted">Tus datos quedaron registrados. Ya podés cerrar esta página. ¡Te esperamos!</p>
        )}
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
            <label className="label" htmlFor="f-nombre">Nombre *</label>
            <input id="f-nombre" name="first_name" required autoComplete="given-name" defaultValue={v.first_name} className={field} />
          </div>
          <div>
            <label className="label" htmlFor="f-apellido">Apellido</label>
            <input id="f-apellido" name="last_name" autoComplete="family-name" defaultValue={v.last_name} className={field} />
          </div>
          <div>
            <label className="label" htmlFor="f-cel">Celular (WhatsApp) *</label>
            <input id="f-cel" name="phone" required type="tel" inputMode="tel" autoComplete="tel" placeholder="351 612 3456" defaultValue={v.phone} className={field} />
          </div>
          <div>
            <label className="label" htmlFor="f-mail">Email</label>
            <input id="f-mail" name="email" type="email" inputMode="email" autoComplete="email" defaultValue={v.email} className={field} />
          </div>
          <div>
            <label className="label" htmlFor="f-dni">DNI</label>
            <input id="f-dni" name="dni" inputMode="numeric" defaultValue={v.dni} className={field} />
          </div>
          <div>
            <label className="label" htmlFor="f-nac">Fecha de nacimiento</label>
            <DateField id="f-nac" name="birth_date" autoComplete="bday" defaultValue={v.birth_date} className={field} birthday />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="f-dom">Domicilio</label>
            <input id="f-dom" name="address" autoComplete="street-address" defaultValue={v.address} className={field} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="f-src">¿Cómo nos conociste? *</label>
            <select id="f-src" name="source" required defaultValue={v.source ?? ""} className={field}>
              <option value="">Elegí una opción</option>
              {PATIENT_SOURCES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="card space-y-3 text-sm">
        <label className="flex items-start gap-3">
          <input type="checkbox" name="consent_data" required defaultChecked={v.consent_data === "on"} className="mt-0.5 h-5 w-5 shrink-0" />
          <span>
            Autorizo a {clinic} a guardar mis datos para mi atención, según la Ley 25.326 de protección de datos
            personales. *
          </span>
        </label>
        <label className="flex items-start gap-3">
          <input type="checkbox" name="consent_marketing" defaultChecked={v.consent_marketing === "on"} className="mt-0.5 h-5 w-5 shrink-0" />
          <span>Quiero recibir recordatorios y novedades por WhatsApp y email.</span>
        </label>
      </div>

      {state?.error && <p className="alert-error">{state.error}</p>}
      <SubmitButton pendingText="Enviando..." className="btn btn-primary w-full py-3 text-base">
        Enviar mis datos
      </SubmitButton>
    </form>
  );
}

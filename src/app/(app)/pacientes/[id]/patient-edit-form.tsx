"use client";

import { useActionState } from "react";
import { updatePatient } from "../../actions";
import { SubmitButton } from "@/components/submit-button";
import { DateField } from "@/components/date-fields";
import { PATIENT_SOURCES } from "@/lib/format";
import type { ActionState, Patient } from "@/lib/types";

// completing: se usa para completar una ficha incompleta (pide el consentimiento y vuelve a `back`)
export function PatientEditForm({
  patient,
  completing = false,
  back,
}: {
  patient: Patient;
  completing?: boolean;
  back?: string;
}) {
  const missingConsent = !patient.consent_data_at;
  const [state, action] = useActionState<ActionState, FormData>(updatePatient, null);
  const v: Record<string, string> = state?.values ?? {
    first_name: patient.first_name,
    last_name: patient.last_name ?? "",
    phone: patient.phone ?? "",
    dni: patient.dni ?? "",
    email: patient.email ?? "",
    birth_date: patient.birth_date ?? "",
    address: patient.address ?? "",
    source: patient.source ?? "",
    notes: patient.notes ?? "",
    consent_marketing: patient.consent_marketing_at ? "on" : "",
    opt_out: patient.marketing_opt_out_at ? "on" : "",
  };

  return (
    <form key={JSON.stringify(v)} action={action} className="space-y-3">
      <input type="hidden" name="id" value={patient.id} />
      {back && <input type="hidden" name="back" value={back} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Nombre</label>
          <input name="first_name" required defaultValue={v.first_name} className="input" />
        </div>
        <div>
          <label className="label">Apellido</label>
          <input name="last_name" defaultValue={v.last_name} className="input" />
        </div>
        <div>
          <label className="label">Celular</label>
          <input name="phone" inputMode="tel" defaultValue={v.phone} className="input" />
        </div>
        <div>
          <label className="label">DNI</label>
          <input name="dni" defaultValue={v.dni} className="input" />
        </div>
        <div>
          <label className="label">Email</label>
          <input name="email" type="email" defaultValue={v.email} className="input" />
        </div>
        <div>
          <label className="label">Domicilio</label>
          <input name="address" defaultValue={v.address} className="input" />
        </div>
        <div>
          <label className="label">Nacimiento</label>
          <DateField name="birth_date" defaultValue={v.birth_date} birthday />
        </div>
        <div>
          <label className="label">Origen</label>
          <select name="source" defaultValue={v.source} className="input">
            <option value="">—</option>
            {PATIENT_SOURCES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="label">Notas</label>
        <textarea name="notes" rows={2} defaultValue={v.notes} className="input" />
      </div>
      <div className="space-y-1 text-sm">
        {missingConsent && (
          <label className="flex items-start gap-2 rounded-lg bg-subtle p-2">
            <input type="checkbox" name="consent_data" required={completing} className="mt-0.5" />
            <span>La paciente aceptó que guardemos sus datos para su atención{completing ? " (obligatorio)" : ""}.</span>
          </label>
        )}
        <label className="flex items-center gap-2">
          <input type="checkbox" name="consent_marketing" defaultChecked={v.consent_marketing === "on"} />
          Acepta recordatorios por WhatsApp y email
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="opt_out" defaultChecked={v.opt_out === "on"} />
          Pidió no ser contactada
        </label>
      </div>
      {state?.error && <p className="alert-error">{state.error}</p>}
      {state?.ok && <p className="alert-ok">{state.ok}</p>}
      <div className="flex justify-end">
        <SubmitButton>{completing ? "Completar ficha" : "Guardar cambios"}</SubmitButton>
      </div>
    </form>
  );
}

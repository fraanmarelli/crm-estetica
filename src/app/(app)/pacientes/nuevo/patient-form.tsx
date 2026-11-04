"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createPatient, type PatientActionState } from "../../actions";
import { SubmitButton } from "@/components/submit-button";
import { PATIENT_SOURCES } from "@/lib/format";

export function NewPatientForm({ next }: { next: { turno: string; fecha: string; vista: string } }) {
  const [state, action] = useActionState<PatientActionState, FormData>(createPatient, null);
  const v = state?.values ?? {};
  const hasDupes = Boolean(state?.duplicates?.length);
  // Rápida: solo lo necesario para dar el turno; el resto lo completa ella después
  const [quick, setQuick] = useState(v.quick ? v.quick === "1" : next.turno === "1");

  return (
    // La key fuerza a recargar los valores escritos si hubo un error
    <form key={JSON.stringify(v)} action={action} className="card space-y-4">
      {next.turno && <input type="hidden" name="next_turno" value="1" />}
      {next.fecha && <input type="hidden" name="next_fecha" value={next.fecha} />}
      {next.vista && <input type="hidden" name="next_vista" value={next.vista} />}
      <input type="hidden" name="quick" value={quick ? "1" : ""} />
      <div className="grid grid-cols-2 gap-1 rounded-full bg-subtle p-1 text-sm font-semibold" role="radiogroup" aria-label="Tipo de carga">
        {[
          { value: true, label: "Rápida, para dar el turno" },
          { value: false, label: "Ficha completa" },
        ].map((o) => (
          <button
            key={o.label}
            type="button"
            role="radio"
            aria-checked={quick === o.value}
            onClick={() => setQuick(o.value)}
            className={`rounded-full px-3 py-1.5 ${quick === o.value ? "bg-surface text-ink shadow-sm" : "text-muted"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {quick && (
        <p className="text-sm text-muted">
          Solo nombre, celular y cómo nos conoció. Queda como «Ficha incompleta» y el resto (DNI, mail, consentimiento)
          lo completa ella con un QR cuando llega, o lo cargás vos.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Nombre *</label>
          <input name="first_name" required defaultValue={v.first_name} className="input" />
        </div>
        <div>
          <label className="label">Apellido</label>
          <input name="last_name" defaultValue={v.last_name} className="input" />
        </div>
        <div>
          <label className="label">Celular (WhatsApp) *</label>
          <input
            name="phone"
            required
            inputMode="tel"
            placeholder="11 5555-1234"
            defaultValue={v.phone}
            className="input"
          />
        </div>
        <div className={quick ? "hidden" : ""}>
          <label className="label">DNI</label>
          <input name="dni" inputMode="numeric" defaultValue={v.dni} className="input" />
        </div>
        <div className={quick ? "hidden" : ""}>
          <label className="label">Email</label>
          <input name="email" type="email" defaultValue={v.email} className="input" />
          <p className="mt-1 text-xs text-muted">Sin email no le llegan los recordatorios automáticos por mail.</p>
        </div>
        <div className={quick ? "hidden" : ""}>
          <label className="label">Domicilio</label>
          <input name="address" defaultValue={v.address} className="input" />
        </div>
        <div className={quick ? "hidden" : ""}>
          <label className="label">Fecha de nacimiento</label>
          <input name="birth_date" type="date" defaultValue={v.birth_date} className="input" />
        </div>
        <div>
          <label className="label">¿Cómo nos conoció? *</label>
          <select name="source" required className="input" defaultValue={v.source ?? ""}>
            <option value="">—</option>
            {PATIENT_SOURCES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>
      <div className={quick ? "hidden" : ""}>
        <label className="label">Notas</label>
        <textarea name="notes" rows={2} defaultValue={v.notes} className="input" />
      </div>

      <div className={`space-y-2 rounded-lg bg-subtle p-3 text-sm ${quick ? "hidden" : ""}`}>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            name="consent_data"
            required={!quick}
            defaultChecked={v.consent_data === "on"}
            className="mt-0.5"
          />
          <span>La paciente aceptó que guardemos sus datos para su atención (obligatorio).</span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            name="consent_marketing"
            defaultChecked={v.consent_marketing === "on"}
            className="mt-0.5"
          />
          <span>Acepta recibir recordatorios y novedades por WhatsApp y email.</span>
        </label>
      </div>

      {state?.error && <p className="alert-error">{state.error}</p>}
      {hasDupes && (
        <div className="space-y-2 rounded-lg border border-warn-line bg-warn-soft p-3 text-sm">
          <p className="font-medium text-warn">Posibles coincidencias:</p>
          <ul className="space-y-1">
            {state!.duplicates!.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2">
                <span>
                  {d.display_name} · {d.home_branch ?? "sin sucursal"}
                </span>
                <Link
                  href={`/turnos/nuevo?paciente=${d.id}${next.fecha ? `&fecha=${next.fecha}` : ""}${next.vista ? `&vista=${next.vista}` : ""}`}
                  className="link"
                >
                  Darle un turno
                </Link>
              </li>
            ))}
          </ul>
          <label className="flex items-center gap-2 text-warn">
            <input type="checkbox" name="force" value="1" />
            Es otra persona, crear igual
          </label>
        </div>
      )}

      <div className="flex justify-end">
        <SubmitButton>Guardar paciente</SubmitButton>
      </div>
    </form>
  );
}

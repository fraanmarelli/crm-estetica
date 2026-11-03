"use client";

import { useActionState, useMemo, useState } from "react";
import { saveAppointment } from "@/app/(app)/actions";
import { SubmitButton } from "@/components/submit-button";
import { PAYMENT_METHODS, STATUS_LABEL, pluralEs } from "@/lib/format";
import type {
  ActionState,
  AppointmentItemInput,
  AppointmentStatus,
  Professional,
  Treatment,
} from "@/lib/types";

export type AppointmentDefaults = {
  id?: string;
  scheduled_at: string; // formato datetime-local
  status: AppointmentStatus;
  professional_id: string;
  amount_paid: string;
  payment_method: string;
  notes: string;
  items: AppointmentItemInput[];
};

const emptyItem = (): AppointmentItemInput => ({ treatment_id: "", zone: "", quantity: "", price: "" });

export function AppointmentForm({
  patientId,
  treatments,
  professionals,
  defaults,
}: {
  patientId: string;
  treatments: Treatment[];
  professionals: Professional[];
  defaults: AppointmentDefaults;
}) {
  const [state, action] = useActionState<ActionState, FormData>(saveAppointment, null);
  const [scheduledAt, setScheduledAt] = useState(defaults.scheduled_at);
  const [status, setStatus] = useState<AppointmentStatus>(defaults.status);
  const [professionalId, setProfessionalId] = useState(defaults.professional_id);
  const [items, setItems] = useState<AppointmentItemInput[]>(
    defaults.items.length ? defaults.items : [emptyItem()],
  );
  const [amount, setAmount] = useState(defaults.amount_paid);
  const [amountTouched, setAmountTouched] = useState(Boolean(defaults.amount_paid));
  const [paymentMethod, setPaymentMethod] = useState(defaults.payment_method);
  const [notes, setNotes] = useState(defaults.notes);

  const byCategory = useMemo(() => {
    const groups = new Map<string, Treatment[]>();
    for (const t of treatments) {
      const key = t.category ?? "Otros";
      groups.set(key, [...(groups.get(key) ?? []), t]);
    }
    return [...groups.entries()];
  }, [treatments]);

  const itemsTotal = items.reduce((s, i) => s + (Number(i.price) || 0), 0);
  const shownAmount = amountTouched ? amount : itemsTotal ? String(itemsTotal) : "";

  function updateItem(index: number, patch: Partial<AppointmentItemInput>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  function selectTreatment(index: number, treatmentId: string) {
    updateItem(index, { treatment_id: treatmentId });
  }

  const showPayment = status === "completed";

  return (
    <form action={action} className="card space-y-5">
      {defaults.id && <input type="hidden" name="id" value={defaults.id} />}
      <input type="hidden" name="patient_id" value={patientId} />
      <input type="hidden" name="items" value={JSON.stringify(items)} />

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label">Fecha y hora</label>
          <input
            type="datetime-local"
            name="scheduled_at"
            required
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label className="label">Profesional</label>
          <select
            name="professional_id"
            value={professionalId}
            onChange={(e) => setProfessionalId(e.target.value)}
            className="input"
          >
            <option value="">—</option>
            {professionals.map((p) => (
              <option key={p.id} value={p.id}>{p.full_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Estado</label>
          <select
            name="status"
            value={status}
            onChange={(e) => setStatus(e.target.value as AppointmentStatus)}
            className="input"
          >
            {(Object.keys(STATUS_LABEL) as AppointmentStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="label mb-0">Tratamientos</span>
          <button type="button" className="btn btn-sm" onClick={() => setItems((p) => [...p, emptyItem()])}>
            + Agregar
          </button>
        </div>
        {items.map((item, index) => {
          const t = treatments.find((x) => x.id === item.treatment_id);
          return (
            <div key={index} className="grid gap-2 rounded-lg bg-subtle p-2 sm:grid-cols-[2fr_1.5fr_1fr_1fr_auto]">
              <select
                value={item.treatment_id}
                onChange={(e) => selectTreatment(index, e.target.value)}
                className="input"
                aria-label="Tratamiento"
              >
                <option value="">Elegí un tratamiento</option>
                {byCategory.map(([category, list]) => (
                  <optgroup key={category} label={category}>
                    {list.map((tr) => (
                      <option key={tr.id} value={tr.id}>{tr.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <input
                value={item.zone}
                onChange={(e) => updateItem(index, { zone: e.target.value })}
                placeholder="Zona"
                className="input"
              />
              <input
                value={item.quantity}
                onChange={(e) => updateItem(index, { quantity: e.target.value })}
                placeholder={t?.supply ? `Cantidad (${pluralEs(t.supply.unit)})` : "Cantidad"}
                aria-label="Cantidad de insumo usada"
                inputMode="decimal"
                className="input"
              />
              <input
                value={item.price}
                onChange={(e) => updateItem(index, { price: e.target.value })}
                placeholder="Precio cobrado"
                aria-label="Precio cobrado"
                inputMode="numeric"
                className="input"
              />
              <button
                type="button"
                className="btn"
                onClick={() => setItems((p) => (p.length === 1 ? [emptyItem()] : p.filter((_, i) => i !== index)))}
                aria-label="Quitar"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      {showPayment && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Total cobrado</label>
            <input
              name="amount_paid"
              inputMode="numeric"
              value={shownAmount}
              onChange={(e) => {
                setAmountTouched(true);
                setAmount(e.target.value);
              }}
              className="input"
            />
          </div>
          <div>
            <label className="label">Medio de pago</label>
            <select
              name="payment_method"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="input"
            >
              <option value="">—</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div>
        <label className="label">Notas</label>
        <textarea name="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="input" />
      </div>

      {state?.error && <p className="alert-error">{state.error}</p>}

      <div className="flex justify-end">
        <SubmitButton>{defaults.id ? "Guardar turno" : "Crear turno"}</SubmitButton>
      </div>
    </form>
  );
}

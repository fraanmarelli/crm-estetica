"use client";

import { useActionState, useMemo, useState } from "react";
import { saveAppointment } from "@/app/(app)/actions";
import { SubmitButton } from "@/components/submit-button";
import { STATUS_LABEL, pluralEs } from "@/lib/format";
import type {
  ActionState,
  AppointmentItemInput,
  AppointmentStatus,
  PaymentAccount,
  PaymentInput,
  Professional,
  Treatment,
} from "@/lib/types";

export type AppointmentDefaults = {
  id?: string;
  scheduled_at: string; // formato datetime-local
  status: AppointmentStatus;
  professional_id: string;
  notes: string;
  items: AppointmentItemInput[];
  payments: PaymentInput[];
  // Solo para marca y franquiciado
  commission?: string; // "" = automática
};

const emptyItem = (): AppointmentItemInput => ({ treatment_id: "", zone: "", quantity: "", price: "" });
const emptyPayment = (): PaymentInput => ({ account_id: "", amount: "", exchange_rate: "" });
const toNum = (s: string) => {
  const n = Number(String(s).replace(/\./g, "").replace(",", "."));
  return String(s).trim() === "" || !Number.isFinite(n) ? 0 : n;
};
const money = (v: number, currency = "ARS") =>
  v.toLocaleString("es-AR", { style: "currency", currency, maximumFractionDigits: 0 });

export function AppointmentForm({
  patientId,
  treatments,
  professionals,
  accounts,
  canSeeCosts,
  defaults,
}: {
  patientId: string;
  treatments: Treatment[];
  professionals: Professional[];
  accounts: PaymentAccount[];
  canSeeCosts: boolean;
  defaults: AppointmentDefaults;
}) {
  const [state, action] = useActionState<ActionState, FormData>(saveAppointment, null);
  const [scheduledAt, setScheduledAt] = useState(defaults.scheduled_at);
  const [status, setStatus] = useState<AppointmentStatus>(defaults.status);
  const [professionalId, setProfessionalId] = useState(defaults.professional_id);
  const [items, setItems] = useState<AppointmentItemInput[]>(defaults.items.length ? defaults.items : [emptyItem()]);
  const [payments, setPayments] = useState<PaymentInput[]>(
    defaults.payments.length ? defaults.payments : [emptyPayment()],
  );
  const [notes, setNotes] = useState(defaults.notes);
  const [commission, setCommission] = useState(defaults.commission ?? "");

  const byCategory = useMemo(() => {
    const groups = new Map<string, Treatment[]>();
    for (const t of treatments) {
      const key = t.category ?? "Otros";
      groups.set(key, [...(groups.get(key) ?? []), t]);
    }
    return [...groups.entries()];
  }, [treatments]);

  const accountById = (id: string) => accounts.find((a) => a.id === id);
  const itemsTotal = items.reduce((s, i) => s + toNum(i.price), 0);
  const paidArs = payments.reduce((s, p) => {
    const acc = accountById(p.account_id);
    if (!acc) return s;
    if (acc.currency === "ARS") return s + toNum(p.amount);
    return p.exchange_rate ? s + toNum(p.amount) * toNum(p.exchange_rate) : s;
  }, 0);
  const paidUsd = payments.reduce(
    (s, p) => (accountById(p.account_id)?.currency === "USD" ? s + toNum(p.amount) : s),
    0,
  );
  const difference = itemsTotal - paidArs;

  function updateItem(index: number, patch: Partial<AppointmentItemInput>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }
  function updatePayment(index: number, patch: Partial<PaymentInput>) {
    setPayments((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  const completed = status === "completed";

  return (
    <form action={action} className="card space-y-6">
      {defaults.id && <input type="hidden" name="id" value={defaults.id} />}
      <input type="hidden" name="patient_id" value={patientId} />
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      <input type="hidden" name="payments" value={JSON.stringify(completed ? payments : [])} />

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="appt-date">Fecha y hora</label>
          <input
            id="appt-date"
            type="datetime-local"
            name="scheduled_at"
            required
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="appt-prof">Médico/a</label>
          <select
            id="appt-prof"
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
          <label className="label" htmlFor="appt-status">Estado</label>
          <select
            id="appt-status"
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

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2>Tratamientos</h2>
          <button type="button" className="btn btn-sm" onClick={() => setItems((p) => [...p, emptyItem()])}>
            Agregar tratamiento
          </button>
        </div>
        {items.map((item, index) => {
          const t = treatments.find((x) => x.id === item.treatment_id);
          return (
            <div key={index} className="grid gap-2 rounded-xl bg-subtle p-2 sm:grid-cols-[2fr_1.3fr_1fr_1fr_auto]">
              <select
                value={item.treatment_id}
                onChange={(e) => updateItem(index, { treatment_id: e.target.value })}
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
                aria-label="Zona"
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
                aria-label="Quitar tratamiento"
              >
                ✕
              </button>
            </div>
          );
        })}
      </section>

      {completed && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2>Cobro</h2>
            <button type="button" className="btn btn-sm" onClick={() => setPayments((p) => [...p, emptyPayment()])}>
              Agregar parte
            </button>
          </div>
          <p className="text-xs text-muted">Si pagó en varias partes, cargá una línea por cada cuenta.</p>
          {payments.map((p, index) => {
            const acc = accountById(p.account_id);
            const usd = acc?.currency === "USD";
            return (
              <div key={index} className={`grid gap-2 rounded-xl bg-subtle p-2 ${usd ? "sm:grid-cols-[2fr_1fr_1fr_auto]" : "sm:grid-cols-[2fr_1fr_auto]"}`}>
                <select
                  value={p.account_id}
                  onChange={(e) => updatePayment(index, { account_id: e.target.value })}
                  className="input"
                  aria-label="Cuenta"
                >
                  <option value="">Elegí la cuenta</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.currency === "USD" ? " (US$)" : ""}
                    </option>
                  ))}
                </select>
                <input
                  value={p.amount}
                  onChange={(e) => updatePayment(index, { amount: e.target.value })}
                  placeholder={usd ? "Monto en US$" : "Monto"}
                  aria-label="Monto"
                  inputMode="numeric"
                  className="input"
                />
                {usd && (
                  <input
                    value={p.exchange_rate}
                    onChange={(e) => updatePayment(index, { exchange_rate: e.target.value })}
                    placeholder="Cotización (opcional)"
                    aria-label="Cotización"
                    inputMode="numeric"
                    className="input"
                  />
                )}
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    setPayments((prev) => (prev.length === 1 ? [emptyPayment()] : prev.filter((_, i) => i !== index)))
                  }
                  aria-label="Quitar parte"
                >
                  ✕
                </button>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span>
              Cobrado: <b className="num">{money(paidArs)}</b>
              {paidUsd > 0 && <b className="num"> + {money(paidUsd, "USD")}</b>}
            </span>
            {itemsTotal > 0 && Math.abs(difference) >= 1 && (
              <span className={difference > 0 ? "text-warn" : "text-muted"}>
                {difference > 0
                  ? `Faltan ${money(difference)} para el precio de los tratamientos`
                  : `${money(-difference)} más que el precio de los tratamientos`}
                {paidUsd > 0 && " (los dólares sin cotización no se cuentan)"}
              </span>
            )}
          </div>
        </section>
      )}

      {completed && canSeeCosts && (
        <section className="space-y-2">
          <h2>Comisión médica</h2>
          <div className="grid gap-2 sm:grid-cols-[1fr_2fr] sm:items-center">
            <input
              name="commission"
              value={commission}
              onChange={(e) => setCommission(e.target.value)}
              placeholder="Automática"
              aria-label="Comisión médica"
              inputMode="numeric"
              className="input"
            />
            <p className="text-xs text-muted">
              Vacío = se calcula sola con el porcentaje del médico. Escribí un monto solo si este turno se liquida
              distinto. Recepción no ve este campo.
            </p>
          </div>
        </section>
      )}

      <div>
        <label className="label" htmlFor="appt-notes">Comentario</label>
        <textarea
          id="appt-notes"
          name="notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="input"
        />
      </div>

      {state?.error && <p className="alert-error">{state.error}</p>}

      <div className="flex justify-end">
        <SubmitButton>{defaults.id ? "Guardar turno" : "Crear turno"}</SubmitButton>
      </div>
    </form>
  );
}

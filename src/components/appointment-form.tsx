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
  duration_minutes: string;
  status: AppointmentStatus;
  professional_id: string;
  notes: string;
  items: AppointmentItemInput[];
  payments: PaymentInput[];
  // Solo para marca y franquiciado
  commission?: string; // "" = automática
};

const DURATIONS = [15, 20, 30, 45, 60, 90, 120, 180];

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
  const [duration, setDuration] = useState(defaults.duration_minutes || "30");
  const [status, setStatus] = useState<AppointmentStatus>(defaults.status);
  const [professionalId, setProfessionalId] = useState(defaults.professional_id);
  const [items, setItems] = useState<AppointmentItemInput[]>(defaults.items.length ? defaults.items : [emptyItem()]);
  const initialDeposit = defaults.payments.find((p) => p.is_deposit) ?? null;
  const initialRest = defaults.payments.filter((p) => !p.is_deposit);
  const [hasDeposit, setHasDeposit] = useState(Boolean(initialDeposit));
  const [deposit, setDeposit] = useState<PaymentInput>(initialDeposit ?? { ...emptyPayment(), is_deposit: true });
  const [payments, setPayments] = useState<PaymentInput[]>(initialRest.length ? initialRest : [emptyPayment()]);
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

  // Cada parte del cobro en pesos; los dólares cuentan solo si tienen cotización
  function inPesos(list: PaymentInput[]) {
    let ars = 0;
    let usdRated = 0;
    let usdUnrated = 0;
    for (const p of list) {
      const acc = accountById(p.account_id);
      if (!acc) continue;
      if (acc.currency === "ARS") ars += toNum(p.amount);
      else if (toNum(p.exchange_rate) > 0) {
        ars += toNum(p.amount) * toNum(p.exchange_rate);
        usdRated += toNum(p.amount);
      } else usdUnrated += toNum(p.amount);
    }
    return { ars, usdRated, usdUnrated };
  }
  const depositSum = inPesos(hasDeposit ? [deposit] : []);
  const restSum = inPesos(payments);
  const paidArs = depositSum.ars + restSum.ars;
  const usdRated = depositSum.usdRated + restSum.usdRated;
  const usdUnrated = depositSum.usdUnrated + restSum.usdUnrated;
  const difference = itemsTotal - paidArs;

  function updateItem(index: number, patch: Partial<AppointmentItemInput>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  const completed = status === "completed";

  // Una línea de cobro (cuenta + monto + cotización si es en dólares)
  function paymentRow(
    p: PaymentInput,
    onChange: (patch: Partial<PaymentInput>) => void,
    onRemove: () => void,
    key: string,
  ) {
    const usd = accountById(p.account_id)?.currency === "USD";
    return (
      <div
        key={key}
        className={`grid gap-2 rounded-xl bg-subtle p-2 ${usd ? "sm:grid-cols-[2fr_1fr_1fr_auto]" : "sm:grid-cols-[2fr_1fr_auto]"}`}
      >
        <select
          value={p.account_id}
          onChange={(e) => onChange({ account_id: e.target.value })}
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
          onChange={(e) => onChange({ amount: e.target.value })}
          placeholder={usd ? "Monto en US$" : "Monto"}
          aria-label="Monto"
          inputMode="numeric"
          className="input"
        />
        {usd && (
          <input
            value={p.exchange_rate}
            onChange={(e) => onChange({ exchange_rate: e.target.value })}
            placeholder="Cotización (opcional)"
            aria-label="Cotización"
            inputMode="numeric"
            className="input"
          />
        )}
        <button type="button" className="btn" onClick={onRemove} aria-label="Quitar">
          ✕
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="card space-y-6">
      {defaults.id && <input type="hidden" name="id" value={defaults.id} />}
      <input type="hidden" name="patient_id" value={patientId} />
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      <input
        type="hidden"
        name="payments"
        value={JSON.stringify([...(hasDeposit ? [{ ...deposit, is_deposit: true }] : []), ...(completed ? payments : [])])}
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <div className="sm:col-span-1">
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
          <label className="label" htmlFor="appt-duration">Duración</label>
          <select
            id="appt-duration"
            name="duration_minutes"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="input"
          >
            {[...new Set([...DURATIONS, Number(duration)])]
              .sort((a, b) => a - b)
              .map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`}
                </option>
              ))}
          </select>
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

      {!completed && status !== "cancelled" && (
        <section className="space-y-2">
          <h2>Seña</h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={hasDeposit} onChange={(e) => setHasDeposit(e.target.checked)} />
            Reservó pagando una seña
          </label>
          {hasDeposit && (
            <>
              {paymentRow(deposit, (patch) => setDeposit((d) => ({ ...d, ...patch })), () => setHasDeposit(false), "deposit")}
              <p className="text-sm text-muted">
                Seña: <b className="num text-ink">{money(depositSum.ars)}</b>
                {depositSum.usdUnrated > 0 && ` + ${money(depositSum.usdUnrated, "USD")} sin cotización`}
                {itemsTotal > 0 && depositSum.usdUnrated === 0 && (
                  <>
                    {" "}· falta cobrar al atender <b className="num text-ink">{money(Math.max(itemsTotal - depositSum.ars, 0))}</b>
                  </>
                )}
                . Se descuenta sola cuando registres el turno.
              </p>
            </>
          )}
        </section>
      )}

      {completed && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2>Cobro</h2>
            <button type="button" className="btn btn-sm" onClick={() => setPayments((p) => [...p, emptyPayment()])}>
              Agregar parte
            </button>
          </div>
          <p className="text-xs text-muted">Si pagó en varias partes, cargá una línea por cada cuenta.</p>

          {hasDeposit && (
            <div className="space-y-1">
              <span className="badge badge-blue">Seña cobrada al reservar</span>
              {paymentRow(deposit, (patch) => setDeposit((d) => ({ ...d, ...patch })), () => setHasDeposit(false), "deposit")}
            </div>
          )}
          {payments.map((p, index) =>
            paymentRow(
              p,
              (patch) => setPayments((prev) => prev.map((x, i) => (i === index ? { ...x, ...patch } : x))),
              () => setPayments((prev) => (prev.length === 1 ? [emptyPayment()] : prev.filter((_, i) => i !== index))),
              `p-${index}`,
            ),
          )}

          <dl className="grid gap-1 rounded-xl border border-line p-3 text-sm sm:max-w-md">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Total de los tratamientos</dt>
              <dd className="num">{money(itemsTotal)}</dd>
            </div>
            {hasDeposit && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Seña</dt>
                <dd className="num">{money(depositSum.ars)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-muted">{hasDeposit ? "Cobrado hoy" : "Cobrado"}</dt>
              <dd className="num">{money(restSum.ars)}</dd>
            </div>
            {usdRated > 0 && (
              <p className="text-xs text-muted">Incluye {money(usdRated, "USD")} pasados a pesos con la cotización cargada.</p>
            )}
            {usdUnrated > 0 && (
              <p className="text-xs text-warn">
                {money(usdUnrated, "USD")} sin cotización: no se suman a los pesos. Cargá la cotización para comparar con el
                total.
              </p>
            )}
          </dl>

          {itemsTotal > 0 && usdUnrated === 0 && (
            Math.abs(difference) < 1 ? (
              <p className="alert-ok">Cobro completo.</p>
            ) : difference > 0 ? (
              <p className="rounded-lg border border-warn-line bg-warn-soft px-3 py-2 text-sm text-warn">
                Falta cobrar <b className="num">{money(difference)}</b>.
              </p>
            ) : (
              <p className="alert-error" role="alert">
                Estás cobrando <b className="num">{money(-difference)}</b> de más que el precio de los tratamientos. Revisá
                los montos.
              </p>
            )
          )}
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

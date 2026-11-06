"use client";

import { useActionState, useMemo, useState } from "react";
import { saveAppointment } from "@/app/(app)/actions";
import { SubmitButton } from "@/components/submit-button";
import { DateTimeField } from "@/components/date-fields";
import { STATUS_LABEL, groupThousands, moneyInputValue, pluralEs } from "@/lib/format";
import type {
  ActionState,
  AppointmentItemInput,
  AppointmentStatus,
  PaymentAccount,
  PaymentInput,
  Professional,
  Promotion,
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

// Un renglón de "Tratamientos": un tratamiento suelto o una promo entera (un solo precio).
// Al guardar, la promo se convierte en sus tratamientos (para recall, insumos y Klaviyo)
// con el precio repartido entre ellos.
type Row = {
  treatment_id: string;
  zone: string;
  quantity: string;
  price: string;
  promotion_id: string;
  promotion_name: string;
  promo_items: { treatment_id: string; zone: string }[];
  // Lote del insumo (jeringa, vial): en una promo, vale para sus tratamientos con insumo
  lot_code: string;
};

const DURATIONS = [15, 20, 30, 45, 60, 90, 120, 180];
// Zonas más usadas (se sugieren al escribir; se puede poner cualquier otra)
const ZONES = [
  "Frente",
  "Entrecejo",
  "Patas de gallo",
  "Bunny lines",
  "Labios",
  "Surcos nasogenianos",
  "Ojeras",
  "Pómulos",
  "Mentón",
  "Mandíbula",
  "Maseteros",
  "Cuello",
  "Nariz",
  "Sonrisa gingival",
];

const emptyRow = (): Row => ({
  treatment_id: "",
  zone: "",
  quantity: "",
  price: "",
  promotion_id: "",
  promotion_name: "",
  promo_items: [],
  lot_code: "",
});
const emptyPayment = (): PaymentInput => ({ account_id: "", amount: "", exchange_rate: "" });
const toNum = (s: string) => {
  const n = Number(String(s).replace(/\./g, "").replace(",", "."));
  return String(s).trim() === "" || !Number.isFinite(n) ? 0 : n;
};
const money = (v: number, currency = "ARS") =>
  v.toLocaleString("es-AR", { style: "currency", currency, maximumFractionDigits: 0 });
// Para el servidor: sin puntos de miles y con coma decimal (así lo lee numOrNull)
const forServer = (n: number) => String(n).replace(".", ",");

// Ítems guardados → renglones (los de una misma promo vuelven a ser uno)
function toRows(items: AppointmentItemInput[]): Row[] {
  const rows: Row[] = [];
  const byPromo = new Map<string, Row>();
  for (const it of items) {
    if (it.promotion_id) {
      const existing = byPromo.get(it.promotion_id);
      if (existing) {
        existing.price = moneyInputValue(toNum(existing.price) + toNum(it.price));
        existing.promo_items.push({ treatment_id: it.treatment_id, zone: it.zone });
        existing.quantity = "";
        existing.lot_code = existing.lot_code || (it.lot_code ?? "");
        continue;
      }
      const row: Row = {
        ...emptyRow(),
        promotion_id: it.promotion_id,
        promotion_name: it.promotion_name ?? "Promo",
        price: moneyInputValue(it.price),
        quantity: it.quantity,
        promo_items: [{ treatment_id: it.treatment_id, zone: it.zone }],
        lot_code: it.lot_code ?? "",
      };
      byPromo.set(it.promotion_id, row);
      rows.push(row);
    } else {
      rows.push({
        ...emptyRow(),
        ...it,
        price: moneyInputValue(it.price),
        promotion_id: "",
        promotion_name: "",
        lot_code: it.lot_code ?? "",
      });
    }
  }
  return rows;
}

// Renglones → ítems que se guardan
function toItems(rows: Row[], hasSupply: (treatmentId: string) => boolean): AppointmentItemInput[] {
  const out: AppointmentItemInput[] = [];
  for (const r of rows) {
    if (r.promotion_id) {
      const list = r.promo_items;
      if (!list.length) continue;
      const total = toNum(r.price);
      const hasPrice = r.price.trim() !== "";
      const share = Math.floor(total / list.length);
      list.forEach((it, i) => {
        out.push({
          treatment_id: it.treatment_id,
          zone: it.zone,
          quantity: list.length === 1 ? r.quantity : "",
          price: hasPrice ? forServer(i === list.length - 1 ? total - share * (list.length - 1) : share) : "",
          promotion_id: r.promotion_id,
          lot_code: list.length === 1 || hasSupply(it.treatment_id) ? r.lot_code : "",
        });
      });
    } else if (r.treatment_id) {
      out.push({
        treatment_id: r.treatment_id,
        zone: r.zone,
        quantity: r.quantity,
        price: r.price.trim() === "" ? "" : forServer(toNum(r.price)),
        lot_code: r.lot_code,
      });
    }
  }
  return out;
}

export function AppointmentForm({
  patientId,
  treatments,
  professionals,
  accounts,
  promotions = [],
  lastLots = {},
  canSeeCosts,
  canClinical = false,
  clinicalNote = "",
  defaults,
  mode = "full",
  returnView,
}: {
  patientId: string;
  treatments: Treatment[];
  professionals: Professional[];
  accounts: PaymentAccount[];
  promotions?: Promotion[];
  /** Último lote usado en la sucursal por tratamiento, para proponerlo */
  lastLots?: Record<string, string>;
  canSeeCosts: boolean;
  /** Profesional, franquiciado o marca: escribe la nota de la sesión (historia clínica). Recepción no. */
  canClinical?: boolean;
  clinicalNote?: string;
  defaults: AppointmentDefaults;
  // "checkout" = registrar que se atendió y cobrar: estado fijo en realizado, fecha plegada
  mode?: "full" | "checkout";
  // Vista de la agenda a la que volver después de guardar ("semana" o "mes")
  returnView?: string;
}) {
  const fmtPayment = (p: PaymentInput): PaymentInput => ({
    ...p,
    amount: moneyInputValue(p.amount),
    exchange_rate: moneyInputValue(p.exchange_rate),
  });
  const [state, action] = useActionState<ActionState, FormData>(saveAppointment, null);
  const [scheduledAt, setScheduledAt] = useState(defaults.scheduled_at);
  const [duration, setDuration] = useState(defaults.duration_minutes || "30");
  const [status, setStatus] = useState<AppointmentStatus>(defaults.status);
  const [professionalId, setProfessionalId] = useState(defaults.professional_id);
  const [rows, setRows] = useState<Row[]>(() => {
    const r = toRows(defaults.items);
    return r.length ? r : [emptyRow()];
  });
  const initialDeposit = defaults.payments.find((p) => p.is_deposit) ?? null;
  const initialRest = defaults.payments.filter((p) => !p.is_deposit);
  const [hasDeposit, setHasDeposit] = useState(Boolean(initialDeposit));
  const [deposit, setDeposit] = useState<PaymentInput>(
    initialDeposit ? fmtPayment(initialDeposit) : { ...emptyPayment(), is_deposit: true },
  );
  const [payments, setPayments] = useState<PaymentInput[]>(
    initialRest.length ? initialRest.map(fmtPayment) : [emptyPayment()],
  );
  const [notes, setNotes] = useState(defaults.notes);
  const [note, setNote] = useState(clinicalNote);
  const [commission, setCommission] = useState(moneyInputValue(defaults.commission ?? ""));

  const byCategory = useMemo(() => {
    const groups = new Map<string, Treatment[]>();
    for (const t of treatments) {
      const key = t.category ?? "Otros";
      groups.set(key, [...(groups.get(key) ?? []), t]);
    }
    return [...groups.entries()];
  }, [treatments]);
  const treatmentName = (id: string) => treatments.find((t) => t.id === id)?.name ?? "Tratamiento";

  const accountById = (id: string) => accounts.find((a) => a.id === id);
  const itemsTotal = rows.reduce((s, r) => s + toNum(r.price), 0);

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
  const usdUnrated = depositSum.usdUnrated + restSum.usdUnrated;
  const difference = itemsTotal - paidArs;
  // Detalle de cada parte en dólares con su cotización (transparencia administrativa)
  const usdLines = [
    ...(hasDeposit ? [{ ...deposit, is_deposit: true }] : []),
    ...(status === "completed" ? payments : []),
  ]
    .filter((p) => accountById(p.account_id)?.currency === "USD" && toNum(p.exchange_rate) > 0 && toNum(p.amount) > 0)
    .map((p) => ({
      account: accountById(p.account_id)!.name,
      usd: toNum(p.amount),
      rate: toNum(p.exchange_rate),
      deposit: Boolean(p.is_deposit),
    }));

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  // Elegir en el selector: un tratamiento o una promo (valor "promo:<id>")
  function pick(index: number, value: string) {
    if (value.startsWith("promo:")) {
      const promo = promotions.find((p) => p.id === value.slice(6));
      if (!promo) return;
      const list = [...promo.items].sort((a, b) => a.sort_order - b.sort_order);
      const withLot = list.find((it) => lastLots[it.treatment_id]);
      updateRow(index, {
        treatment_id: "",
        zone: "",
        quantity: "",
        promotion_id: promo.id,
        promotion_name: promo.name,
        promo_items: list.map((it) => ({ treatment_id: it.treatment_id, zone: it.zone ?? "" })),
        price: moneyInputValue(promo.price),
        lot_code: withLot ? lastLots[withLot.treatment_id] : "",
      });
    } else {
      updateRow(index, {
        treatment_id: value,
        promotion_id: "",
        promotion_name: "",
        promo_items: [],
        lot_code: lastLots[value] ?? "",
      });
    }
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
        className={`grid items-center gap-2 rounded-xl bg-subtle p-3 ${
          usd ? "grid-cols-[1fr_1fr_auto] sm:grid-cols-[2fr_1fr_1fr_auto]" : "grid-cols-[1fr_auto] sm:grid-cols-[2fr_1fr_auto]"
        }`}
      >
        <select
          value={p.account_id}
          onChange={(e) => onChange({ account_id: e.target.value })}
          className={`input ${usd ? "col-span-3" : "col-span-2"} sm:col-span-1`}
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
          onChange={(e) => onChange({ amount: groupThousands(e.target.value) })}
          placeholder={usd ? "Monto en US$" : "Monto"}
          aria-label="Monto"
          inputMode="decimal"
          className="input num"
        />
        {usd && (
          <input
            value={p.exchange_rate}
            onChange={(e) => onChange({ exchange_rate: groupThousands(e.target.value) })}
            placeholder="Cotización (opcional)"
            aria-label="Cotización"
            inputMode="decimal"
            className="input num"
          />
        )}
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center justify-self-end rounded-full text-muted hover:bg-surface hover:text-ink"
          onClick={onRemove}
          aria-label="Quitar"
          title="Quitar"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    );
  }

  const durationSelect = (
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
  );

  const professionalSelect = (
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
  );

  return (
    <form action={action} className="card space-y-6">
      {defaults.id && <input type="hidden" name="id" value={defaults.id} />}
      <input type="hidden" name="patient_id" value={patientId} />
      {returnView && <input type="hidden" name="return_view" value={returnView} />}
      <input
        type="hidden"
        name="items"
        value={JSON.stringify(toItems(rows, (id) => Boolean(treatments.find((t) => t.id === id)?.supply)))}
      />
      <input
        type="hidden"
        name="payments"
        value={JSON.stringify([...(hasDeposit ? [{ ...deposit, is_deposit: true }] : []), ...(completed ? payments : [])])}
      />

      {mode === "checkout" ? (
        <>
          <input type="hidden" name="status" value="completed" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="appt-prof">Atendió</label>
              {professionalSelect}
            </div>
          </div>
          <details className="rounded-xl bg-subtle px-3 py-2">
            <summary className="cursor-pointer text-sm font-semibold text-muted">Cambiar fecha u horario</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-[2fr_1fr]">
              <div>
                <label className="label" htmlFor="appt-date">Fecha y hora</label>
                <DateTimeField id="appt-date" name="scheduled_at" value={scheduledAt} onChange={setScheduledAt} />
              </div>
              <div>
                <label className="label" htmlFor="appt-duration">Duración</label>
                {durationSelect}
              </div>
            </div>
          </details>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="col-span-2 sm:col-span-1">
            <label className="label" htmlFor="appt-date">Día y hora</label>
            <DateTimeField id="appt-date" name="scheduled_at" value={scheduledAt} onChange={setScheduledAt} />
          </div>
          <div>
            <label className="label" htmlFor="appt-duration">Duración</label>
            {durationSelect}
          </div>
          <div>
            <label className="label" htmlFor="appt-prof">Médico/a</label>
            {professionalSelect}
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
      )}

      <section className="space-y-3 border-t border-line pt-5">
        <div className="flex items-center justify-between">
          <h2>{mode === "checkout" ? "Qué se hizo" : "Tratamientos"}</h2>
          <button type="button" className="btn btn-sm" onClick={() => setRows((p) => [...p, emptyRow()])}>
            Agregar tratamiento
          </button>
        </div>
        {rows.map((row, index) => {
          const t = treatments.find((x) => x.id === row.treatment_id);
          const isPromo = Boolean(row.promotion_id);
          const singlePromoTreatment =
            isPromo && row.promo_items.length === 1 ? treatments.find((x) => x.id === row.promo_items[0].treatment_id) : null;
          const supply = isPromo ? singlePromoTreatment?.supply : t?.supply;
          const showQuantity = !isPromo || row.promo_items.length === 1;
          // Lote: si el tratamiento (o alguno de la promo) usa un insumo
          const showLot = isPromo
            ? row.promo_items.some((it) => treatments.find((x) => x.id === it.treatment_id)?.supply)
            : Boolean(t?.supply);
          const fields = (isPromo ? 0 : 1) + (showQuantity ? 1 : 0) + (showLot ? 1 : 0) + 1;
          const gridCls =
            fields === 1
              ? "grid-cols-1 sm:max-w-[12rem]"
              : fields === 2
                ? "grid-cols-2"
                : fields === 3
                  ? "grid-cols-2 sm:grid-cols-3"
                  : "grid-cols-2 sm:grid-cols-4";
          // Si la promo ya no está vigente (turno viejo), igual se muestra en el selector
          const promoMissing = isPromo && !promotions.some((p) => p.id === row.promotion_id);
          return (
            <div key={index} className="space-y-3 rounded-xl bg-subtle p-3">
              <div className="flex items-center gap-2">
                <select
                  value={isPromo ? `promo:${row.promotion_id}` : row.treatment_id}
                  onChange={(e) => pick(index, e.target.value)}
                  className="input min-w-0 flex-1"
                  aria-label="Tratamiento o promo"
                >
                  <option value="">Elegí un tratamiento o una promo</option>
                  {(promotions.length > 0 || promoMissing) && (
                    <optgroup label="Promos">
                      {promoMissing && <option value={`promo:${row.promotion_id}`}>{row.promotion_name}</option>}
                      {promotions.map((p) => (
                        <option key={p.id} value={`promo:${p.id}`}>
                          {p.name} · {money(p.price)}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {byCategory.map(([category, list]) => (
                    <optgroup key={category} label={category}>
                      {list.map((tr) => (
                        <option key={tr.id} value={tr.id}>{tr.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <button
                  type="button"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-ink"
                  onClick={() => setRows((p) => (p.length === 1 ? [emptyRow()] : p.filter((_, i) => i !== index)))}
                  aria-label="Quitar tratamiento"
                  title="Quitar"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              {isPromo && row.promo_items.length > 0 && (
                <p className="text-xs text-muted">
                  Incluye{" "}
                  {row.promo_items
                    .map((it) => `${treatmentName(it.treatment_id)}${it.zone ? ` (${it.zone})` : ""}`)
                    .join(" + ")}
                </p>
              )}
              <div className={`grid gap-2 ${gridCls}`}>
                {!isPromo && (
                  <div>
                    <label className="mb-1 block text-xs text-muted" htmlFor={`zone-${index}`}>Zona</label>
                    <input
                      id={`zone-${index}`}
                      value={row.zone}
                      onChange={(e) => updateRow(index, { zone: e.target.value })}
                      placeholder="Opcional"
                      list="zone-suggestions"
                      autoComplete="off"
                      className="input"
                    />
                  </div>
                )}
                {showQuantity && (
                  <div>
                    <label className="mb-1 block text-xs text-muted" htmlFor={`qty-${index}`}>
                      {supply ? `Cantidad (${pluralEs(supply.unit)})` : "Cantidad"}
                    </label>
                    <input
                      id={`qty-${index}`}
                      value={row.quantity}
                      onChange={(e) => updateRow(index, { quantity: e.target.value })}
                      placeholder="Opcional"
                      inputMode="decimal"
                      className="input"
                    />
                  </div>
                )}
                {showLot && (
                  <div>
                    <label className="mb-1 block text-xs text-muted" htmlFor={`lot-${index}`}>Lote</label>
                    <input
                      id={`lot-${index}`}
                      value={row.lot_code}
                      onChange={(e) => updateRow(index, { lot_code: e.target.value.toUpperCase().slice(0, 60) })}
                      placeholder="Del envase"
                      autoComplete="off"
                      className="input num uppercase"
                    />
                  </div>
                )}
                <div className={fields % 2 === 1 && fields > 1 ? "col-span-2 sm:col-span-1" : ""}>
                  <label className="mb-1 block text-xs text-muted" htmlFor={`price-${index}`}>Precio cobrado</label>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted">$</span>
                    <input
                      id={`price-${index}`}
                      value={row.price}
                      onChange={(e) => updateRow(index, { price: groupThousands(e.target.value) })}
                      inputMode="decimal"
                      className="input num pl-7 font-semibold"
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </section>

      <datalist id="zone-suggestions">
        {ZONES.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>

      {completed && canClinical && (
        <section className="space-y-2 border-t border-line pt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h2>Nota de la sesión</h2>
            <span className="text-xs text-muted">Historia clínica · no la ve recepción</span>
          </div>
          <textarea
            name="clinical_note"
            rows={3}
            maxLength={4000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Qué se hizo, cómo respondió, indicaciones y próximo paso"
            className="input"
          />
        </section>
      )}

      {!completed && status !== "cancelled" && (
        <section className="space-y-3 border-t border-line pt-5">
          <h2>Seña</h2>
          <label className="flex items-center gap-2.5 text-sm">
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
        <section className="space-y-3 border-t border-line pt-5">
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

          <dl className="grid gap-1 rounded-xl bg-subtle p-3 text-sm sm:max-w-md">
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
            {usdLines.map((l, i) => (
              <div key={i} className="flex justify-between gap-4 text-xs text-muted">
                <dt>
                  {l.account}: {money(l.usd, "USD")} × cotización {money(l.rate)}
                  {l.deposit ? " (seña)" : ""}
                </dt>
                <dd className="num">{money(l.usd * l.rate)}</dd>
              </div>
            ))}
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
        <section className="space-y-3 border-t border-line pt-5">
          <h2>Comisión médica</h2>
          <div className="grid gap-2 sm:grid-cols-[1fr_2fr] sm:items-center">
            <input
              name="commission"
              value={commission}
              onChange={(e) => setCommission(groupThousands(e.target.value))}
              placeholder="Automática"
              aria-label="Comisión médica"
              inputMode="decimal"
              className="input num"
            />
            <p className="text-xs text-muted">
              Vacío = se calcula sola con el porcentaje del médico. Escribí un monto solo si este turno se liquida
              distinto. Recepción no ve este campo.
            </p>
          </div>
        </section>
      )}

      <div className="border-t border-line pt-5">
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
        <SubmitButton>
          {mode === "checkout" ? "Registrar atención y cobro" : defaults.id ? "Guardar turno" : "Crear turno"}
        </SubmitButton>
      </div>
    </form>
  );
}

"use client";

import { useActionState, useMemo, useState } from "react";
import { issueInvoice } from "../actions";
import { SubmitButton } from "@/components/submit-button";
import { fmtMoney, groupThousands } from "@/lib/format";
import { parseMoney, roundCents } from "@/lib/money";
import type { ActionState } from "@/lib/types";

export type IssuerOption = {
  id: string;
  label: string; // «Marian Pérez · 20-12345678-9»
  test: boolean;
  amount: number | null; // lo que cobró en este turno
  lines: { description: string; quantity: number; unit_price: number }[];
};

type Line = { description: string; quantity: string; price: string };

const IVA = [
  { id: 5, label: "Consumidor final" },
  { id: 6, label: "Responsable monotributo" },
  { id: 1, label: "IVA responsable inscripto" },
  { id: 4, label: "IVA sujeto exento" },
  { id: 13, label: "Monotributista social" },
  { id: 15, label: "IVA no alcanzado" },
];
const IDENTIFY_FROM = 10_000_000;

const toLines = (ls: IssuerOption["lines"]): Line[] =>
  ls.length
    ? ls.map((l) => ({
        description: l.description,
        quantity: String(l.quantity).replace(".", ","),
        price: groupThousands(String(l.unit_price).replace(".", ",")),
      }))
    : [{ description: "", quantity: "1", price: "" }];

export function InvoiceForm({
  issuers,
  defaultIssuer,
  appointmentId,
  defaultConcept,
  patient,
}: {
  issuers: IssuerOption[];
  defaultIssuer: string;
  appointmentId: string | null;
  defaultConcept: "productos" | "servicios";
  patient: { name: string; dni: string } | null;
}) {
  const [state, action] = useActionState<ActionState, FormData>(issueInvoice, null);
  const v = state?.values;
  const [issuerId, setIssuerId] = useState(v?.connection_id ?? defaultIssuer);
  const issuer = issuers.find((i) => i.id === issuerId) ?? issuers[0];
  const [lines, setLines] = useState<Line[]>(() => toLines(issuer?.lines ?? []));
  const [docType, setDocType] = useState(v?.doc_type ?? (patient?.dni ? "dni" : "ninguno"));
  const [iva, setIva] = useState(v?.iva_condition ?? "5");

  const parsed = useMemo(
    () =>
      lines.map((l) => ({
        description: l.description.trim(),
        quantity: parseMoney(l.quantity),
        unit_price: parseMoney(l.price),
      })),
    [lines],
  );
  const total = roundCents(parsed.reduce((s, l) => s + roundCents(l.quantity * l.unit_price), 0));
  const mustIdentify = total >= IDENTIFY_FROM && docType === "ninguno";

  const set = (i: number, patch: Partial<Line>) => setLines((s) => s.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="lines" value={JSON.stringify(parsed)} />
      {appointmentId && <input type="hidden" name="appointment_id" value={appointmentId} />}

      <section className="card space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="connection_id" className="label">Quién factura</label>
          <select
            id="connection_id"
            name="connection_id"
            value={issuerId}
            onChange={(e) => {
              setIssuerId(e.target.value);
              const next = issuers.find((i) => i.id === e.target.value);
              if (next && appointmentId) setLines(toLines(next.lines));
            }}
            className="input"
          >
            {issuers.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
                {i.amount ? ` · cobró ${fmtMoney(i.amount)} en este turno` : ""}
                {i.test ? " · PRUEBA" : ""}
              </option>
            ))}
          </select>
          {issuer?.test && (
            <p className="text-xs text-warn">Este titular está en el ambiente de prueba de ARCA: la factura no tiene validez fiscal.</p>
          )}
        </div>

        <fieldset className="space-y-1.5">
          <legend className="label">Qué se factura</legend>
          <div className="flex gap-4 text-sm">
            {(["productos", "servicios"] as const).map((c) => (
              <label key={c} className="flex items-center gap-2">
                <input type="radio" name="concept" value={c} defaultChecked={(v?.concept ?? defaultConcept) === c} />
                {c === "productos" ? "Productos" : "Servicios"}
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="card space-y-3">
        <h2 className="text-base">Detalle</h2>
        <ul className="space-y-3">
          {lines.map((l, i) => {
            const sub = roundCents(parseMoney(l.quantity) * parseMoney(l.price));
            return (
              <li key={i} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_5rem_8rem_7rem_auto] sm:items-end">
                <div className="col-span-2 space-y-1 sm:col-span-1">
                  {i === 0 && <span className="hidden text-xs text-muted sm:block">Descripción</span>}
                  <input
                    value={l.description}
                    onChange={(e) => set(i, { description: e.target.value })}
                    placeholder="Ej. Botox (toxina botulínica)"
                    aria-label="Descripción"
                    className="input"
                    maxLength={200}
                  />
                </div>
                <div className="space-y-1">
                  {i === 0 && <span className="hidden text-xs text-muted sm:block">Cantidad</span>}
                  <input
                    value={l.quantity}
                    onChange={(e) => set(i, { quantity: e.target.value.replace(/[^\d,]/g, "") })}
                    inputMode="decimal"
                    aria-label="Cantidad"
                    className="input num"
                  />
                </div>
                <div className="space-y-1">
                  {i === 0 && <span className="hidden text-xs text-muted sm:block">Precio unitario</span>}
                  <input
                    value={l.price}
                    onChange={(e) => set(i, { price: groupThousands(e.target.value) })}
                    inputMode="decimal"
                    placeholder="$"
                    aria-label="Precio unitario"
                    className="input num"
                  />
                </div>
                <p className="num self-center text-right text-sm sm:pb-2.5">{fmtMoney(sub)}</p>
                <button
                  type="button"
                  onClick={() => setLines((s) => (s.length > 1 ? s.filter((_, j) => j !== i) : s))}
                  disabled={lines.length === 1}
                  className="btn btn-sm self-center disabled:opacity-30"
                  aria-label="Quitar línea"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
        {lines.length < 15 && (
          <button
            type="button"
            onClick={() => setLines((s) => [...s, { description: "", quantity: "1", price: "" }])}
            className="btn btn-sm"
          >
            + Agregar línea
          </button>
        )}
        <div className="flex items-baseline justify-end gap-3 border-t border-line pt-3">
          <span className="text-sm text-muted">Total</span>
          <span className="num text-xl font-semibold">{fmtMoney(total)}</span>
        </div>
      </section>

      <section className="card space-y-4">
        <h2 className="text-base">Cliente</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="doc_type" className="label">Documento</label>
            <select
              id="doc_type"
              name="doc_type"
              value={docType}
              onChange={(e) => {
                setDocType(e.target.value);
                if (e.target.value === "ninguno") setIva("5");
              }}
              className="input"
            >
              <option value="ninguno">Sin identificar (consumidor final)</option>
              <option value="dni">DNI</option>
              <option value="cuit">CUIT</option>
              <option value="cuil">CUIL</option>
            </select>
          </div>
          {docType !== "ninguno" && (
            <div className="space-y-1.5">
              <label htmlFor="doc_number" className="label">Número</label>
              <input
                id="doc_number"
                name="doc_number"
                defaultValue={v?.doc_number ?? (docType === "dni" ? (patient?.dni ?? "") : "")}
                inputMode="numeric"
                className="input num"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <label htmlFor="receiver_name" className="label">Nombre o razón social (opcional)</label>
            <input id="receiver_name" name="receiver_name" defaultValue={v?.receiver_name ?? patient?.name ?? ""} className="input" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="iva_condition" className="label">Condición frente al IVA</label>
            <select id="iva_condition" name="iva_condition" value={iva} onChange={(e) => setIva(e.target.value)} className="input">
              {IVA.map((c) => (
                <option key={c.id} value={c.id} disabled={docType === "ninguno" && c.id !== 5}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {mustIdentify && (
          <p className="text-sm text-warn">Desde {fmtMoney(IDENTIFY_FROM)} ARCA pide el DNI o el CUIT del cliente.</p>
        )}
      </section>

      {state?.error && <p className="alert-error">{state.error}</p>}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <p className="text-xs text-muted">Se pide el CAE a ARCA en el momento. Una factura emitida no se borra: se anula con nota de crédito.</p>
        <SubmitButton pendingText="Pidiendo el CAE a ARCA...">Emitir factura por {fmtMoney(total)}</SubmitButton>
      </div>
    </form>
  );
}

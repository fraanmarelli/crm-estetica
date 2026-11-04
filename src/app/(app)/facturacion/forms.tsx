"use client";

import { useActionState, useState } from "react";
import { assignHolders, createHolder, updateHolder } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import type { ActionState } from "@/lib/types";

export type HolderFields = {
  id?: string;
  name: string;
  cuit: string | null;
  annual_limit: number | null;
  alert_pct: number;
};

function Messages({ state }: { state: ActionState }) {
  return (
    <>
      {state?.error && <p className="alert-error">{state.error}</p>}
      {state?.ok && <p className="alert-ok">{state.ok}</p>}
    </>
  );
}

const fmtPlain = (n: number | null) => (n === null ? "" : n.toLocaleString("es-AR", { maximumFractionDigits: 0 }));

// Alta o edición de un titular
export function HolderForm({ holder }: { holder?: HolderFields }) {
  const [state, action] = useActionState<ActionState, FormData>(holder?.id ? updateHolder : createHolder, null);
  const id = holder?.id ?? "new";
  return (
    <form key={holder?.id ? id : (state?.ok ?? id)} action={action} className="space-y-3">
      {holder?.id && <input type="hidden" name="id" value={holder.id} />}
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem_11rem_7rem]">
        <div>
          <label className="label" htmlFor={`h-name-${id}`}>Titular</label>
          <input id={`h-name-${id}`} name="name" required defaultValue={holder?.name} placeholder="Ej. Mariano" className="input" />
        </div>
        <div>
          <label className="label" htmlFor={`h-cuit-${id}`}>CUIT (opcional)</label>
          <input id={`h-cuit-${id}`} name="cuit" defaultValue={holder?.cuit ?? ""} inputMode="numeric" className="input num" />
        </div>
        <div>
          <label className="label" htmlFor={`h-limit-${id}`}>Tope 12 meses</label>
          <input
            id={`h-limit-${id}`}
            name="annual_limit"
            defaultValue={fmtPlain(holder?.annual_limit ?? null)}
            inputMode="numeric"
            placeholder="$ de su categoría"
            className="input num"
          />
        </div>
        <div>
          <label className="label" htmlFor={`h-pct-${id}`}>Avisar al</label>
          <div className="flex items-center gap-1">
            <input
              id={`h-pct-${id}`}
              name="alert_pct"
              defaultValue={String(holder?.alert_pct ?? 80)}
              inputMode="numeric"
              className="input num"
            />
            <span className="text-sm text-muted">%</span>
          </div>
        </div>
      </div>
      <Messages state={state} />
      <div className="flex justify-end">
        <SubmitButton className="btn">{holder?.id ? "Guardar" : "Agregar titular"}</SubmitButton>
      </div>
    </form>
  );
}

type AccountRow = {
  account_id: string;
  account_name: string;
  currency: string;
  is_active: boolean;
  holder_id: string | null;
  total_ars: number;
  total_usd: number;
  payments_count: number;
};

const money = (v: number, currency = "ARS") =>
  v.toLocaleString("es-AR", { style: "currency", currency, maximumFractionDigits: 0 });

// Tabla de cuentas del mes, con el titular de cada una
export function AccountsTable({
  accounts,
  holders,
  monthLabel,
}: {
  accounts: AccountRow[];
  holders: { id: string; name: string }[];
  monthLabel: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(assignHolders, null);
  const [assign, setAssign] = useState<Record<string, string>>(
    Object.fromEntries(accounts.map((a) => [a.account_id, a.holder_id ?? ""])),
  );
  const changed = accounts.some((a) => (a.holder_id ?? "") !== assign[a.account_id]);
  const total = accounts.reduce((s, a) => s + Number(a.total_ars), 0);
  const counted = accounts
    .filter((a) => assign[a.account_id])
    .reduce((s, a) => s + Number(a.total_ars), 0);
  const visible = accounts.filter((a) => a.is_active || Number(a.total_ars) > 0 || Number(a.total_usd) > 0);

  return (
    <form action={action} className="space-y-3">
      <input
        type="hidden"
        name="rows"
        value={JSON.stringify(Object.entries(assign).map(([account_id, holder_id]) => ({ account_id, holder_id })))}
      />
      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr>
              <th>Cuenta</th>
              <th className="w-48">Titular</th>
              <th className="w-20 text-right">Cobros</th>
              <th className="w-36 text-right">{monthLabel}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((a) => (
              <tr key={a.account_id}>
                <td>
                  <span className="font-medium">{a.account_name}</span>
                  {!a.is_active && <span className="ml-2 badge badge-gray">Inactiva</span>}
                </td>
                <td>
                  {holders.length > 0 ? (
                    <select
                      value={assign[a.account_id]}
                      onChange={(e) => setAssign((s) => ({ ...s, [a.account_id]: e.target.value }))}
                      aria-label={`Titular de ${a.account_name}`}
                      className="input input-sm"
                    >
                      <option value="">No suma</option>
                      {holders.map((h) => (
                        <option key={h.id} value={h.id}>{h.name}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="num text-right text-muted">{a.payments_count}</td>
                <td className="num text-right">
                  {money(Number(a.total_ars))}
                  {Number(a.total_usd) > 0 && (
                    <span className="block text-xs text-muted">{money(Number(a.total_usd), "USD")}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="font-semibold">Total del mes</td>
              <td className="num text-right font-semibold">{money(total)}</td>
            </tr>
            {holders.length > 0 && (
              <tr>
                <td colSpan={3} className="text-muted">Suma para el monotributo (cuentas con titular)</td>
                <td className="num text-right text-muted">{money(counted)}</td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-muted">
        Cada cobro se cuenta en el día del turno. Los dólares suman en pesos solo si tienen cotización.
      </p>
      <Messages state={state} />
      {holders.length > 0 && (
        <div className="flex justify-end">
          <SubmitButton className={changed ? "btn btn-primary" : "btn"}>Guardar titulares</SubmitButton>
        </div>
      )}
    </form>
  );
}

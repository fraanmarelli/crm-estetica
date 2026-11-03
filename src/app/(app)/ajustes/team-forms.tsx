"use client";

import { useActionState, useState } from "react";
import { createAccount, createProfessional, saveAccounts, saveProfessionals } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import type { ActionState } from "@/lib/types";

type Prof = { id: string; full_name: string; commission_pct: number; is_active: boolean };
type Account = { id: string; name: string; currency: "ARS" | "USD"; is_active: boolean };

function Messages({ state }: { state: ActionState }) {
  return (
    <>
      {state?.error && <p className="alert-error">{state.error}</p>}
      {state?.ok && <p className="alert-ok">{state.ok}</p>}
    </>
  );
}

export function ProfessionalsForm({ professionals }: { professionals: Prof[] }) {
  const [state, action] = useActionState<ActionState, FormData>(saveProfessionals, null);
  const [rows, setRows] = useState(
    professionals.map((p) => ({ ...p, commission_pct: String(p.commission_pct ?? 0) })),
  );
  const [newState, newAction] = useActionState<ActionState, FormData>(createProfessional, null);

  return (
    <div className="space-y-4">
      {rows.length > 0 && (
        <form action={action} className="space-y-3">
          <input type="hidden" name="rows" value={JSON.stringify(rows)} />
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th className="w-36">Comisión %</th>
                  <th className="w-24">Activo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id}>
                    <td>
                      <input
                        value={r.full_name}
                        onChange={(e) => setRows((s) => s.map((x, j) => (j === i ? { ...x, full_name: e.target.value } : x)))}
                        aria-label="Nombre"
                        className="input"
                      />
                    </td>
                    <td>
                      <input
                        value={r.commission_pct}
                        onChange={(e) =>
                          setRows((s) => s.map((x, j) => (j === i ? { ...x, commission_pct: e.target.value } : x)))
                        }
                        inputMode="decimal"
                        aria-label={`Comisión de ${r.full_name}`}
                        className="input num"
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={r.is_active}
                        onChange={(e) => setRows((s) => s.map((x, j) => (j === i ? { ...x, is_active: e.target.checked } : x)))}
                        aria-label={`${r.full_name} activo`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Messages state={state} />
          <div className="flex justify-end">
            <SubmitButton>Guardar profesionales</SubmitButton>
          </div>
        </form>
      )}

      <form key={newState?.ok ?? "new-prof"} action={newAction} className="grid gap-2 sm:grid-cols-[1fr_9rem_9rem_auto] sm:items-end">
        <div>
          <label className="label" htmlFor="np-name">Nuevo profesional</label>
          <input id="np-name" name="full_name" required placeholder="Dra. Nombre Apellido" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="np-mat">Matrícula</label>
          <input id="np-mat" name="license_number" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="np-pct">Comisión %</label>
          <input id="np-pct" name="commission_pct" inputMode="decimal" placeholder="0" className="input" />
        </div>
        <SubmitButton className="btn">Agregar</SubmitButton>
        <div className="sm:col-span-4">
          <Messages state={newState} />
        </div>
      </form>
    </div>
  );
}

export function AccountsForm({ accounts }: { accounts: Account[] }) {
  const [state, action] = useActionState<ActionState, FormData>(saveAccounts, null);
  const [rows, setRows] = useState(accounts);
  const [newState, newAction] = useActionState<ActionState, FormData>(createAccount, null);

  return (
    <div className="space-y-4">
      {rows.length > 0 && (
        <form action={action} className="space-y-3">
          <input type="hidden" name="rows" value={JSON.stringify(rows)} />
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="table">
              <thead>
                <tr>
                  <th>Cuenta</th>
                  <th className="w-32">Moneda</th>
                  <th className="w-24">Activa</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id}>
                    <td>
                      <input
                        value={r.name}
                        onChange={(e) => setRows((s) => s.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                        aria-label="Nombre de la cuenta"
                        className="input"
                      />
                    </td>
                    <td>
                      <select
                        value={r.currency}
                        onChange={(e) =>
                          setRows((s) => s.map((x, j) => (j === i ? { ...x, currency: e.target.value as "ARS" | "USD" } : x)))
                        }
                        aria-label="Moneda"
                        className="input"
                      >
                        <option value="ARS">Pesos</option>
                        <option value="USD">Dólares</option>
                      </select>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={r.is_active}
                        onChange={(e) => setRows((s) => s.map((x, j) => (j === i ? { ...x, is_active: e.target.checked } : x)))}
                        aria-label={`${r.name} activa`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">
            Si usás la planilla, el nombre de cada cuenta tiene que ser igual al título de su columna.
          </p>
          <Messages state={state} />
          <div className="flex justify-end">
            <SubmitButton>Guardar cuentas</SubmitButton>
          </div>
        </form>
      )}

      <form key={newState?.ok ?? "new-acc"} action={newAction} className="grid gap-2 sm:grid-cols-[1fr_9rem_auto] sm:items-end">
        <div>
          <label className="label" htmlFor="na-name">Nueva cuenta</label>
          <input id="na-name" name="name" required placeholder="Ej. MP Cami" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="na-cur">Moneda</label>
          <select id="na-cur" name="currency" className="input">
            <option value="ARS">Pesos</option>
            <option value="USD">Dólares</option>
          </select>
        </div>
        <SubmitButton className="btn">Agregar</SubmitButton>
        <div className="sm:col-span-3">
          <Messages state={newState} />
        </div>
      </form>
    </div>
  );
}

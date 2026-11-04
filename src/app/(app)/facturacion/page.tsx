import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireManagerContext } from "@/lib/context";
import { fmtMoney, todayISO } from "@/lib/format";
import { deleteHolder } from "./actions";
import { AccountsTable, HolderForm } from "./forms";

export type HolderStatus = {
  holder_id: string;
  name: string;
  cuit: string | null;
  annual_limit: number | null;
  alert_pct: number;
  month_total: number;
  last12_total: number;
  level: "ok" | "warn" | "over" | "none";
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthName(month: string) {
  const [y, m] = month.split("-").map(Number);
  const label = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("es-AR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}
function lastDay(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

const LEVEL = {
  over: { bar: "bg-bad", badge: "badge-red", text: "Llegó al tope" },
  warn: { bar: "bg-warn", badge: "badge-amber", text: "Cerca del tope" },
  ok: { bar: "bg-ok", badge: "badge-green", text: "Bien" },
  none: { bar: "bg-muted", badge: "badge-gray", text: "Sin tope cargado" },
};

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const ctx = await requireManagerContext();
  const { mes } = await searchParams;
  const current = todayISO().slice(0, 7);
  const month = mes && MONTH.test(mes) ? mes : current;
  const supabase = await createClient();

  const [{ data: holderData, error: holderError }, { data: accountData }] = await Promise.all([
    supabase.rpc("holder_status", { p_branch: ctx.currentBranch.id, p_month: `${month}-01` }),
    supabase.rpc("billing_by_account", {
      p_branch: ctx.currentBranch.id,
      p_from: `${month}-01`,
      p_to: lastDay(month),
    }),
  ]);

  const holders = (holderData ?? []) as HolderStatus[];
  const accounts = (accountData ?? []) as {
    account_id: string;
    account_name: string;
    currency: string;
    is_active: boolean;
    holder_id: string | null;
    holder_name: string | null;
    total_ars: number;
    total_usd: number;
    payments_count: number;
  }[];
  const label = monthName(month);
  const windowLabel = `${monthName(shiftMonth(month, -11))} a ${monthName(month)}`;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="page-head">
        <div>
          <h1>Facturación</h1>
          <p className="page-sub">
            Lo que entró en cada cuenta de {ctx.currentBranch.name}. Para el monotributo cuenta lo de cada titular en los
            últimos 12 meses.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Link href={`/facturacion?mes=${shiftMonth(month, -1)}`} className="btn btn-sm" aria-label="Mes anterior">‹</Link>
          <span className="min-w-36 text-center text-sm font-semibold">{label}</span>
          {month < current ? (
            <Link href={`/facturacion?mes=${shiftMonth(month, 1)}`} className="btn btn-sm" aria-label="Mes siguiente">›</Link>
          ) : (
            <span className="btn btn-sm opacity-40" aria-hidden="true">›</span>
          )}
        </div>
      </div>

      {holderError && <p className="alert-error">No se pudo calcular la facturación: {holderError.message}</p>}

      <section className="space-y-3">
        <div>
          <h2>Titulares</h2>
          <p className="text-sm text-muted">
            Ventana de 12 meses: {windowLabel}. El tope es el de la categoría de cada uno en ARCA; el aviso aparece en la
            agenda cuando se acerca.
          </p>
        </div>

        {holders.length === 0 ? (
          <div className="card text-sm text-muted">
            Todavía no cargaste titulares. Agregá a cada persona que factura (con el tope de su categoría) y después
            asignale sus cuentas en la tabla de abajo.
          </div>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {holders.map((h) => {
              const lvl = LEVEL[h.level];
              const pct = h.annual_limit ? Math.min((Number(h.last12_total) / Number(h.annual_limit)) * 100, 100) : 0;
              const left = h.annual_limit ? Number(h.annual_limit) - Number(h.last12_total) : null;
              return (
                <li key={h.holder_id} className="card space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold">{h.name}</h3>
                      {h.cuit && <p className="num text-xs text-muted">CUIT {h.cuit}</p>}
                    </div>
                    <span className={`badge ${lvl.badge}`}>{lvl.text}</span>
                  </div>
                  <div>
                    <p className="num text-2xl">{fmtMoney(h.last12_total)}</p>
                    <p className="text-xs text-muted">
                      {h.annual_limit
                        ? `de ${fmtMoney(h.annual_limit)} en 12 meses · aviso al ${h.alert_pct}%`
                        : "en 12 meses"}
                    </p>
                  </div>
                  {h.annual_limit && (
                    <div className="h-2 overflow-hidden rounded-full bg-subtle" role="img" aria-label={`${Math.round(pct)}% del tope`}>
                      <div className={`h-full rounded-full ${lvl.bar}`} style={{ width: `${pct}%` }} />
                    </div>
                  )}
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <dt className="text-xs text-muted">{label}</dt>
                      <dd className="num">{fmtMoney(h.month_total)}</dd>
                    </div>
                    {left !== null && (
                      <div>
                        <dt className="text-xs text-muted">{left >= 0 ? "Le queda" : "Se pasó por"}</dt>
                        <dd className={`num ${left < 0 ? "text-bad" : ""}`}>{fmtMoney(Math.abs(left))}</dd>
                      </div>
                    )}
                  </dl>
                  <p className="text-xs text-muted">
                    Cuentas:{" "}
                    {accounts.filter((a) => a.holder_id === h.holder_id).map((a) => a.account_name).join(", ") ||
                      "ninguna todavía"}
                  </p>
                  <details className="rounded-xl bg-subtle px-3 py-2">
                    <summary className="cursor-pointer text-sm font-semibold text-muted">Editar</summary>
                    <div className="mt-3 space-y-3">
                      <HolderForm holder={h.holder_id ? { ...h, id: h.holder_id } : undefined} />
                      <form action={deleteHolder} className="flex justify-end">
                        <input type="hidden" name="id" value={h.holder_id} />
                        <button className="text-xs text-muted underline-offset-2 hover:text-bad hover:underline">
                          Quitar titular (sus cuentas quedan sin titular; no se borra ningún cobro)
                        </button>
                      </form>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}

        <details className="card" open={holders.length === 0}>
          <summary className="cursor-pointer font-semibold">Agregar titular</summary>
          <div className="mt-4">
            <HolderForm />
          </div>
        </details>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2>Cuentas en {label.toLowerCase()}</h2>
            <p className="text-sm text-muted">
              Efectivo y dólares en mano quedan en «No suma». Las cuentas nuevas se agregan en{" "}
              <Link href="/ajustes" className="link">Ajustes</Link>.
            </p>
          </div>
        </div>
        <AccountsTable
          accounts={accounts}
          holders={holders.map((h) => ({ id: h.holder_id, name: h.name }))}
          monthLabel={label}
        />
      </section>
    </div>
  );
}

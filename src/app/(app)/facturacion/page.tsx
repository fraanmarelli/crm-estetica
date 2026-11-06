import Link from "next/link";
import { SectionTabs } from "@/components/section-tabs";
import { createClient } from "@/lib/supabase/server";
import { requireManagerContext } from "@/lib/context";
import { todayISO } from "@/lib/format";
import { AccountsTable, HolderForm } from "./forms";
import { HolderCard, type HolderStatus } from "./holder-card";

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
      <SectionTabs section="numeros" />
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
            {holders.map((h) => (
              <HolderCard
                key={h.holder_id}
                h={h}
                monthLabel={label}
                accountNames={accounts.filter((a) => a.holder_id === h.holder_id).map((a) => a.account_name)}
              />
            ))}
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

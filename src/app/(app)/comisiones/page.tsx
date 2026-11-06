import Link from "next/link";
import { redirect } from "next/navigation";
import { Kpi } from "@/components/kpi";
import { SectionTabs } from "@/components/section-tabs";
import { createClient } from "@/lib/supabase/server";
import { requireBranchContext } from "@/lib/context";
import { fmtDate, fmtMoney, fmtTime, todayISO } from "@/lib/format";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID = /^[0-9a-f-]{36}$/;

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

type Row = {
  appointment_id: string;
  scheduled_at: string;
  professional_id: string;
  professional_name: string;
  patient_name: string;
  treatments: string | null;
  amount_paid: number;
  commission: number;
  commission_manual: boolean;
};

// Comisiones: la profesional ve las suyas (menú «Mis comisiones»); franquiciado y marca, las de todas
// (Números → Comisiones). Los montos salen de professional_commissions(), que valida el permiso.
export default async function CommissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; profesional?: string }>;
}) {
  const ctx = await requireBranchContext();
  const sp = await searchParams;
  const current = todayISO().slice(0, 7);
  const month = sp.mes && MONTH.test(sp.mes) ? sp.mes : current;
  const supabase = await createClient();
  const manager = ctx.canManageCurrentBranch;

  // Profesional: su propia ficha (o la elegida en «Ver como» por la marca)
  let ownId: string | null = null;
  if (!manager) {
    if (ctx.viewAs?.role === "professional") {
      ownId = ctx.viewAs.professionalId;
    } else if (ctx.roles.includes("professional")) {
      const { data: own } = await supabase
        .from("professionals")
        .select("id, branch_id")
        .eq("user_id", ctx.userId)
        .eq("is_active", true);
      ownId =
        ((own ?? []) as { id: string; branch_id: string | null }[]).find(
          (p) => !p.branch_id || p.branch_id === ctx.currentBranch.id,
        )?.id ?? null;
    }
    if (!ownId && !ctx.roles.includes("professional")) redirect("/");
  }

  const { data: pros } = manager
    ? await supabase
        .from("professionals")
        .select("id, full_name, branch_id")
        .eq("organization_id", ctx.org.id)
        .order("full_name")
    : { data: [] };
  const branchPros = ((pros ?? []) as { id: string; full_name: string; branch_id: string | null }[]).filter(
    (p) => !p.branch_id || p.branch_id === ctx.currentBranch.id,
  );
  const selected = manager ? (sp.profesional && UUID.test(sp.profesional) ? sp.profesional : null) : ownId;

  const { data, error } =
    manager || ownId
      ? await supabase.rpc("professional_commissions", {
          p_branch: ctx.currentBranch.id,
          p_professional: selected,
          p_from: `${month}-01`,
          p_to: lastDay(month),
        })
      : { data: [], error: null };
  const rows = (data ?? []) as Row[];
  const cur = ctx.org.currency;

  const total = rows.reduce((s, r) => s + Number(r.commission), 0);
  const billed = rows.reduce((s, r) => s + Number(r.amount_paid), 0);

  // Resumen por profesional (solo franquiciado y marca, con «Todas»)
  const byPro = new Map<string, { name: string; turnos: number; cobrado: number; comision: number }>();
  for (const r of rows) {
    const c = byPro.get(r.professional_id) ?? { name: r.professional_name, turnos: 0, cobrado: 0, comision: 0 };
    c.turnos++;
    c.cobrado += Number(r.amount_paid);
    c.comision += Number(r.commission);
    byPro.set(r.professional_id, c);
  }

  const href = (m: string, p: string | null) =>
    `/comisiones?mes=${m}${manager && p ? `&profesional=${p}` : ""}`;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {manager && <SectionTabs section="numeros" />}
      <div className="page-head">
        <div>
          <h1>{manager ? "Comisiones" : "Mis comisiones"}</h1>
          <p className="page-sub">
            {manager
              ? `Lo que corresponde a cada profesional de ${ctx.currentBranch.name} por los turnos atendidos.`
              : `Tus turnos atendidos en ${ctx.currentBranch.name} y la comisión de cada uno.`}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Link href={href(shiftMonth(month, -1), selected)} className="btn btn-sm" aria-label="Mes anterior">
            ‹
          </Link>
          <span className="min-w-36 text-center text-sm font-semibold">{monthName(month)}</span>
          {month < current ? (
            <Link href={href(shiftMonth(month, 1), selected)} className="btn btn-sm" aria-label="Mes siguiente">
              ›
            </Link>
          ) : (
            <span className="btn btn-sm opacity-40" aria-hidden="true">
              ›
            </span>
          )}
        </div>
      </div>

      {manager && branchPros.length > 0 && (
        <nav aria-label="Profesional" className="-mx-1 overflow-x-auto pb-1">
          <div className="flex w-max gap-1 px-1">
            {[{ id: null as string | null, full_name: "Todas" }, ...branchPros].map((p) => {
              const active = selected === p.id;
              return (
                <Link
                  key={p.id ?? "all"}
                  href={href(month, p.id)}
                  className={`rounded-full border px-3 py-1 text-sm ${
                    active ? "border-ink bg-ink text-surface" : "border-line text-muted hover:text-ink"
                  }`}
                >
                  {p.full_name}
                </Link>
              );
            })}
          </div>
        </nav>
      )}

      {error && <p className="alert-error">No se pudieron calcular las comisiones: {error.message}</p>}
      {!manager && !ownId && (
        <p className="alert-error">
          Tu usuario todavía no está vinculado a tu ficha de profesional. Pedile al franquiciado que te invite desde
          Ajustes → Equipo eligiendo tu nombre.
        </p>
      )}

      <div className="kpi-row grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi label="Comisión del mes" value={fmtMoney(total, cur)} accent={total > 0} />
        <Kpi label="Turnos atendidos" value={String(rows.length)} />
        <Kpi label="Cobrado en esos turnos" value={fmtMoney(billed, cur)} />
      </div>

      {manager && !selected && byPro.size > 0 && (
        <section className="space-y-2">
          <h2>Por profesional</h2>
          <div className="card overflow-x-auto p-0">
            <table className="table">
              <thead>
                <tr>
                  <th>Profesional</th>
                  <th className="text-right">Turnos</th>
                  <th className="text-right">Cobrado</th>
                  <th className="text-right">Comisión a pagar</th>
                </tr>
              </thead>
              <tbody>
                {[...byPro.entries()]
                  .sort((a, b) => b[1].comision - a[1].comision)
                  .map(([id, c]) => (
                    <tr key={id}>
                      <td>
                        <Link href={href(month, id)} className="font-medium hover:text-brand">
                          {c.name}
                        </Link>
                      </td>
                      <td className="num text-right">{c.turnos}</td>
                      <td className="num whitespace-nowrap text-right">{fmtMoney(c.cobrado, cur)}</td>
                      <td className="num whitespace-nowrap text-right font-semibold">{fmtMoney(c.comision, cur)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2>Turno por turno</h2>
        {rows.length === 0 ? (
          <div className="card text-sm text-muted">No hay turnos atendidos en {monthName(month).toLowerCase()}.</div>
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Paciente</th>
                  <th>Tratamiento</th>
                  {manager && !selected && <th>Profesional</th>}
                  <th className="text-right">Cobrado</th>
                  <th className="text-right">Comisión</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.appointment_id}>
                    <td className="whitespace-nowrap">
                      {fmtDate(r.scheduled_at)} <span className="text-xs text-muted">{fmtTime(r.scheduled_at)}</span>
                    </td>
                    <td>
                      <Link href={`/turnos/${r.appointment_id}`} className="hover:text-brand">
                        {r.patient_name || "Paciente"}
                      </Link>
                    </td>
                    <td className="text-muted">{r.treatments ?? "—"}</td>
                    {manager && !selected && <td>{r.professional_name}</td>}
                    <td className="num whitespace-nowrap text-right">{fmtMoney(r.amount_paid, cur)}</td>
                    <td className="num whitespace-nowrap text-right font-semibold">
                      {fmtMoney(r.commission, cur)}
                      {r.commission_manual && <span className="block text-xs font-normal text-muted">a mano</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted">
          La comisión es el porcentaje de cada profesional sobre lo cobrado en el turno; si se cambió a mano en un
          turno, figura «a mano». Cuentan los turnos marcados como atendidos.
        </p>
      </section>
    </div>
  );
}

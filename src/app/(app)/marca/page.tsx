import { createClient } from "@/lib/supabase/server";
import { requireNetworkContext } from "@/lib/context";
import { fmtMoney, todayISO } from "@/lib/format";
import { Kpi } from "@/components/kpi";
import { InviteForm } from "../equipo/invite-form";
import { TeamPanel } from "../equipo/team-panel";
import { BranchForm } from "./branch-form";

type Stat = {
  branch_id: string;
  month: string;
  completed: number;
  no_shows: number;
  cancelled: number;
  revenue: number;
  unique_patients: number;
};

function monthStart(offset: number): string {
  const [y, m] = todayISO().split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return d.toISOString().slice(0, 10);
}

export default async function NetworkPage() {
  const ctx = await requireNetworkContext();
  const supabase = await createClient();
  const current = monthStart(0);
  const previous = monthStart(-1);

  const [{ data: stats }, { data: due }, { count: patientsCount }, { data: ownerData }] = await Promise.all([
    supabase
      .from("branch_monthly_stats")
      .select("branch_id, month, completed, no_shows, cancelled, revenue, unique_patients")
      .eq("organization_id", ctx.org.id)
      .in("month", [current, previous]),
    supabase.from("recall_due_by_branch").select("branch_id, due_count").eq("organization_id", ctx.org.id),
    supabase.from("patients").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id),
    supabase.rpc("branch_owners", { p_org: ctx.org.id }),
  ]);
  const owners = (ownerData ?? []) as { branch_id: string; email: string }[];

  const list = (stats ?? []) as Stat[];
  const get = (branchId: string, month: string) =>
    list.find((s) => s.branch_id === branchId && s.month === month);
  const dueMap = new Map((due ?? []).map((d) => [d.branch_id as string, d.due_count as number]));

  const totals = ctx.branches.reduce(
    (acc, b) => {
      const cur = get(b.id, current);
      acc.completed += cur?.completed ?? 0;
      acc.revenue += Number(cur?.revenue ?? 0);
      acc.prevRevenue += Number(get(b.id, previous)?.revenue ?? 0);
      acc.due += dueMap.get(b.id) ?? 0;
      return acc;
    },
    { completed: 0, revenue: 0, prevRevenue: 0, due: 0 },
  );

  const variation = (cur: number, prev: number) => {
    if (!prev) return "—";
    const pct = ((cur - prev) / prev) * 100;
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`;
  };

  return (
    <div className="space-y-6">
      <div className="page-head">
        <div>
          <h1>Sucursales {ctx.org.name}</h1>
          <p className="page-sub">Todas las sucursales, este mes contra el anterior</p>
        </div>
        <a href="/marketing?vista=marca" className="btn">Ver marketing de la marca</a>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Facturado" value={fmtMoney(totals.revenue, ctx.org.currency)} hint={`${variation(totals.revenue, totals.prevRevenue)} contra el mes anterior`} accent />
        <Kpi label="Turnos atendidos" value={String(totals.completed)} />
        <Kpi label="Pacientes registradas" value={String(patientsCount ?? 0)} />
        <Kpi label="Recall vencido" value={String(totals.due)} hint="Pacientes sin recontactar" />
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr>
              <th>Sucursal</th>
              <th>Atendidas</th>
              <th>No vino</th>
              <th>Pacientes únicas</th>
              <th>Facturado</th>
              <th>vs mes ant.</th>
              <th>Recall vencido</th>
            </tr>
          </thead>
          <tbody>
            {ctx.branches.map((b) => {
              const cur = get(b.id, current);
              const prev = get(b.id, previous);
              return (
                <tr key={b.id}>
                  <td className="font-medium">{b.name}</td>
                  <td>{cur?.completed ?? 0}</td>
                  <td>{cur?.no_shows ?? 0}</td>
                  <td>{cur?.unique_patients ?? 0}</td>
                  <td className="whitespace-nowrap">{fmtMoney(cur?.revenue ?? 0, ctx.org.currency)}</td>
                  <td>{variation(Number(cur?.revenue ?? 0), Number(prev?.revenue ?? 0))}</td>
                  <td>{dueMap.get(b.id) ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        Una sucursal sin turnos cargados aparece en cero: es la señal de que no está usando el sistema.
      </p>

      <section className="card space-y-4">
        <div>
          <h2>Sucursales y franquiciados</h2>
          <p className="text-sm text-muted">
            Creá una sucursal y dale acceso a su franquiciado/a. Después, el franquiciado invita a su equipo desde
            Ajustes.
          </p>
        </div>
        <ul className="divide-y divide-line">
          {ctx.branches.map((b) => {
            const list = owners.filter((o) => o.branch_id === b.id).map((o) => o.email);
            return (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span className="font-semibold">{b.name}</span>
                <span className={list.length ? "text-muted" : "text-warn"}>
                  {list.length ? list.join(", ") : "Sin franquiciado/a con acceso"}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="grid gap-6 border-t border-line pt-4 lg:grid-cols-2">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Dar acceso de franquiciado/a</h3>
            <InviteForm roles={["branch_admin"]} branches={ctx.branches} orgName={ctx.org.name} />
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Nueva sucursal</h3>
            <BranchForm />
          </div>
        </div>
      </section>

      <section className="card space-y-4">
        <div>
          <h2>Equipo de la marca</h2>
          <p className="text-sm text-muted">Personas que ven todas las sucursales, con costos incluidos.</p>
        </div>
        <TeamPanel
          orgId={ctx.org.id}
          orgName={ctx.org.name}
          branchId={null}
          roles={["network_admin", "network_owner"]}
          currentUserId={ctx.userId}
        />
      </section>
    </div>
  );
}

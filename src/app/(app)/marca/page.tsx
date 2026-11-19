import { createClient } from "@/lib/supabase/server";
import { SoonCard } from "@/components/soon";
import { requireNetworkContext } from "@/lib/context";
import { fmtDateTime, fmtMoney, todayISO } from "@/lib/format";
import { Kpi } from "@/components/kpi";
import { InviteForm } from "../equipo/invite-form";
import { TeamPanel } from "../equipo/team-panel";
import { BranchForm } from "./branch-form";
import { FranchiseeDialog } from "./franchisee-dialog";
import { FeaturesForm } from "./features-form";
import { featuresFrom } from "@/lib/context";

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

  const [{ data: stats }, { data: due }, { count: patientsCount }, { data: overviewData }, { data: branchRows }] = await Promise.all([
    supabase
      .from("branch_monthly_stats")
      .select("branch_id, month, completed, no_shows, cancelled, revenue, unique_patients")
      .eq("organization_id", ctx.org.id)
      .in("month", [current, previous]),
    supabase.from("recall_due_by_branch").select("branch_id, due_count").eq("organization_id", ctx.org.id),
    supabase.from("patients").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id),
    // Franquiciados con su último ingreso, equipo y conexiones de la sede (solo la marca)
    supabase.rpc("franchisee_overview", { p_org: ctx.org.id }),
    supabase.from("branches").select("id, disabled_features").eq("organization_id", ctx.org.id),
  ]);
  type Owner = {
    user_id: string;
    email: string;
    full_name: string | null;
    last_sign_in_at: string | null;
    branch_id: string;
    team_count: number;
    mp_accounts: number;
    has_facebook: boolean;
    has_ads: boolean;
    integrations: number;
  };
  const owners = (overviewData ?? []) as Owner[];
  const disabledBy = new Map(
    ((branchRows ?? []) as { id: string; disabled_features: string[] | null }[]).map((b) => [b.id, b.disabled_features ?? []]),
  );

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

      {ctx.showRoadmap && (
        <div className="grid gap-3 sm:grid-cols-2">
          <SoonCard
            title="Sucursales comparadas"
            description="Ventas, ticket promedio, retención y ausencias de cada sucursal lado a lado."
          />
          <SoonCard
            title="Textos del consentimiento informado"
            description="La marca define las cláusulas de cada tratamiento; todas las sucursales las usan al hacer firmar."
          />
        </div>
      )}

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
            const list = owners.filter((o) => o.branch_id === b.id);
            const off = disabledBy.get(b.id) ?? [];
            const note = off.length ? `${off.length} ${off.length === 1 ? "función apagada" : "funciones apagadas"}` : undefined;
            const cur = get(b.id, current);
            const prev = get(b.id, previous);
            // Lo mismo para cualquier franquiciado de la sede (o para la sede sin franquiciado)
            const sede = (o: Owner | null) => (
              <div className="space-y-5">
                {o && (
                  <div>
                    <h2>{o.full_name ?? o.email}</h2>
                    <p className="text-sm text-muted">
                      Franquiciado/a de {b.name}
                      {o.full_name ? ` · ${o.email}` : ""}
                    </p>
                    <p className="mt-1 text-sm">
                      Último ingreso:{" "}
                      <b>{o.last_sign_in_at ? fmtDateTime(o.last_sign_in_at) : "todavía no entró"}</b>
                    </p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <Kpi label="Atendidas este mes" value={String(cur?.completed ?? 0)} />
                  <Kpi
                    label="Facturado"
                    value={fmtMoney(cur?.revenue ?? 0, ctx.org.currency)}
                    hint={`${variation(Number(cur?.revenue ?? 0), Number(prev?.revenue ?? 0))} vs mes ant.`}
                  />
                  <Kpi label="No vinieron" value={String(cur?.no_shows ?? 0)} />
                  <Kpi label="Recall vencido" value={String(dueMap.get(b.id) ?? 0)} />
                </div>
                {o && (
                  <dl className="grid gap-x-6 gap-y-1.5 rounded-xl bg-subtle p-4 text-sm sm:grid-cols-2">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Equipo con acceso</dt>
                      <dd className="font-semibold">{o.team_count} {o.team_count === 1 ? "persona" : "personas"}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Mercado Pago</dt>
                      <dd className="font-semibold">
                        {o.mp_accounts ? `${o.mp_accounts} ${o.mp_accounts === 1 ? "cuenta conectada" : "cuentas conectadas"}` : "Sin conectar"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Página de Facebook (leads)</dt>
                      <dd className="font-semibold">{o.has_facebook ? "Conectada" : "Sin conectar"}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Cuenta de anuncios</dt>
                      <dd className="font-semibold">{o.has_ads ? "Conectada" : "Sin conectar"}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Planilla y calendario</dt>
                      <dd className="font-semibold">{o.integrations ? `${o.integrations} activas` : "Nada conectado"}</dd>
                    </div>
                  </dl>
                )}
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">Funciones de {b.name}</h3>
                  <FeaturesForm branchId={b.id} branchName={b.name} features={featuresFrom(off)} />
                </section>
              </div>
            );
            return (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span className="font-semibold">{b.name}</span>
                <span className="flex flex-wrap items-center gap-2">
                  {list.length ? (
                    list.map((o) => (
                      <FranchiseeDialog
                        key={o.user_id}
                        label={o.full_name ?? o.email}
                        note={note}
                        title={`${o.full_name ?? o.email} · ${b.name}`}
                      >
                        {sede(o)}
                      </FranchiseeDialog>
                    ))
                  ) : (
                    <>
                      <span className="text-warn">Sin franquiciado/a con acceso</span>
                      <FranchiseeDialog label="Funciones" note={note} title={`Funciones · ${b.name}`}>
                        {sede(null)}
                      </FranchiseeDialog>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted">
          Tocá un franquiciado para ver cómo viene su sede y prender o apagar funciones.
        </p>
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

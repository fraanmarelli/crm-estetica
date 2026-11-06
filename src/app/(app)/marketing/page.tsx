import Link from "next/link";
import { SectionTabs } from "@/components/section-tabs";
import { createClient } from "@/lib/supabase/server";
import { requireManagerContext } from "@/lib/context";
import { metaConfigured } from "@/lib/meta";
import { fmtDateTime, fmtMoney, fmtNumber, isoDaysAgo, ratio } from "@/lib/format";
import { SubmitButton } from "@/components/submit-button";
import { Kpi } from "@/components/kpi";
import { disconnectAds } from "./actions";

type Summary = {
  branch_id: string;
  branch_name: string;
  spend: number;
  impressions: number;
  clicks: number;
  messages: number;
  leads: number;
  new_patients: number;
  new_patients_social: number;
  new_patients_revenue: number;
  new_social_revenue: number;
};

type Campaign = {
  campaign_id: string;
  campaign_name: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  messages: number;
  leads: number;
  last_date: string;
};

type Connection = {
  id: string;
  branch_id: string;
  ad_account_id: string;
  ad_account_name: string | null;
  currency: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  token_expires_at: string | null;
};

const PERIODS = [
  { days: 7, label: "7 días" },
  { days: 30, label: "30 días" },
  { days: 90, label: "90 días" },
];

function metrics(s: Summary | undefined) {
  const spend = Number(s?.spend ?? 0);
  const contacts = Number(s?.messages ?? 0) + Number(s?.leads ?? 0);
  const social = Number(s?.new_patients_social ?? 0);
  const revenue = Number(s?.new_social_revenue ?? 0);
  return {
    spend,
    contacts,
    social,
    total: Number(s?.new_patients ?? 0),
    revenue,
    costPerContact: ratio(spend, contacts),
    costPerPatient: ratio(spend, social),
    roas: ratio(revenue, spend),
  };
}

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string; vista?: string; error?: string; ok?: string }>;
}) {
  const ctx = await requireManagerContext();
  const sp = await searchParams;
  const days = PERIODS.find((p) => String(p.days) === sp.dias)?.days ?? 30;
  const brandView = ctx.isNetwork && sp.vista === "marca";
  const from = isoDaysAgo(days);
  const to = isoDaysAgo(0);
  const cur = ctx.org.currency;
  const supabase = await createClient();

  const [{ data: summaryData }, { data: connData }, { data: campaignData }] = await Promise.all([
    supabase.rpc("marketing_summary", { p_org: ctx.org.id, p_from: from, p_to: to }),
    supabase
      .from("ad_connections")
      .select("id, branch_id, ad_account_id, ad_account_name, currency, last_synced_at, last_error, token_expires_at")
      .eq("organization_id", ctx.org.id),
    brandView
      ? Promise.resolve({ data: [] })
      : supabase.rpc("campaign_summary", { p_branch: ctx.currentBranch.id, p_from: from, p_to: to }),
  ]);

  const summaries = (summaryData ?? []) as Summary[];
  const connections = (connData ?? []) as Connection[];
  const campaigns = (campaignData ?? []) as Campaign[];
  const tabs = (
    <div className="flex flex-wrap items-center gap-1">
      {PERIODS.map((p) => (
        <Link
          key={p.days}
          href={`/marketing?dias=${p.days}${brandView ? "&vista=marca" : ""}`}
          className={`btn btn-sm ${p.days === days ? "btn-primary" : ""}`}
        >
          {p.label}
        </Link>
      ))}
      {ctx.isNetwork && (
        <Link
          href={`/marketing?dias=${days}${brandView ? "" : "&vista=marca"}`}
          className="btn btn-sm ml-2"
        >
          {brandView ? `Ver ${ctx.currentBranch.name}` : "Ver toda la marca"}
        </Link>
      )}
    </div>
  );

  const banner = (
    <>
      {sp.error && <p className="alert-error">{sp.error}</p>}
      {sp.ok === "conectado" && (
        <p className="alert-ok">Cuenta conectada. Los datos de los últimos 90 días aparecen en unos minutos.</p>
      )}
    </>
  );

  // ------------------------------------------------------------------
  // Vista de la marca: todas las sucursales
  // ------------------------------------------------------------------
  if (brandView) {
    const rows = summaries.map((s) => ({ s, m: metrics(s), conn: connections.find((c) => c.branch_id === s.branch_id) }));
    const total = metrics(
      summaries.reduce(
        (acc, s) => ({
          ...acc,
          spend: acc.spend + Number(s.spend),
          messages: acc.messages + Number(s.messages),
          leads: acc.leads + Number(s.leads),
          new_patients: acc.new_patients + s.new_patients,
          new_patients_social: acc.new_patients_social + s.new_patients_social,
          new_social_revenue: acc.new_social_revenue + Number(s.new_social_revenue),
        }),
        { spend: 0, messages: 0, leads: 0, new_patients: 0, new_patients_social: 0, new_social_revenue: 0 } as Summary,
      ),
    );
    const alerts = [
      ...rows.filter((r) => !r.conn).map((r) => `${r.s.branch_name}: no conectó su cuenta de Meta.`),
      ...rows
        .filter((r) => r.m.spend > 0 && r.m.social === 0)
        .map((r) => `${r.s.branch_name}: invirtió ${fmtMoney(r.m.spend, cur)} y no registró pacientes nuevas de redes.`),
      ...rows.filter((r) => r.conn?.last_error).map((r) => `${r.s.branch_name}: ${r.conn!.last_error}`),
    ];

    return (
      <div className="space-y-6">
        <SectionTabs section="numeros" />
        <div className="page-head">
          <div>
            <h1>Anuncios</h1>
            <p className="page-sub">Toda la marca, últimos {days} días</p>
          </div>
          {tabs}
        </div>
        {banner}
        <div className="grid gap-3 sm:grid-cols-4">
          <Kpi label="Inversión en Meta" value={fmtMoney(total.spend, cur)} />
          <Kpi label="Pacientes nuevas de redes" value={fmtNumber(total.social)} hint={`de ${total.total} nuevas en total`} />
          <Kpi label="Costo por paciente nueva" value={fmtMoney(total.costPerPatient, cur)} />
          <Kpi
            label="Retorno"
            value={total.roas === null ? "—" : `${fmtNumber(total.roas, 1)}x`}
            hint="Lo facturado por esas pacientes sobre lo invertido"
            accent
          />
        </div>

        {alerts.length > 0 && (
          <div className="card space-y-1 border-warn-line bg-warn-soft">
            <h2 className="text-warn">Para revisar</h2>
            <ul className="list-disc space-y-0.5 pl-5 text-sm text-warn">
              {alerts.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr>
                <th>Sucursal</th>
                <th>Inversión</th>
                <th>Mensajes</th>
                <th>Costo x mensaje</th>
                <th>Nuevas de redes</th>
                <th>Costo x paciente</th>
                <th>Facturado</th>
                <th>Retorno</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .sort((a, b) => (b.m.roas ?? -1) - (a.m.roas ?? -1))
                .map(({ s, m, conn }) => (
                  <tr key={s.branch_id}>
                    <td className="font-medium">
                      {s.branch_name}
                      {!conn && <span className="badge badge-gray ml-1">sin Meta</span>}
                    </td>
                    <td className="whitespace-nowrap">{fmtMoney(m.spend, cur)}</td>
                    <td>{fmtNumber(m.contacts)}</td>
                    <td className="whitespace-nowrap">{fmtMoney(m.costPerContact, cur)}</td>
                    <td>{m.social}</td>
                    <td className="whitespace-nowrap">{fmtMoney(m.costPerPatient, cur)}</td>
                    <td className="whitespace-nowrap">{fmtMoney(m.revenue, cur)}</td>
                    <td>{m.roas === null ? "—" : `${fmtNumber(m.roas, 1)}x`}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          Ordenado por retorno. «Nuevas de redes» = pacientes dadas de alta en el período que dijeron venir de Instagram o
          Facebook. «Facturado» = lo que pagaron esas pacientes desde su alta hasta hoy.
        </p>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Vista de una sucursal
  // ------------------------------------------------------------------
  const summary = summaries.find((s) => s.branch_id === ctx.currentBranch.id);
  const m = metrics(summary);
  const conn = connections.find((c) => c.branch_id === ctx.currentBranch.id);
  const expiresSoon =
    conn?.token_expires_at && new Date(conn.token_expires_at).getTime() - Date.now() < 10 * 86_400_000;
  const currencyMismatch = conn?.currency && conn.currency !== cur;
  const connectHref = `/api/meta/connect?branch=${ctx.currentBranch.id}`;

  return (
    <div className="space-y-6">
      <SectionTabs section="numeros" />
      <div className="page-head">
        <div>
          <h1>Anuncios</h1>
          <p className="page-sub">{ctx.currentBranch.name}, últimos {days} días</p>
        </div>
        {tabs}
      </div>
      {banner}

      <section className="card flex flex-wrap items-center justify-between gap-3">
        {conn ? (
          <>
            <div className="text-sm">
              <p className="font-medium">
                Meta conectado: {conn.ad_account_name ?? conn.ad_account_id}{" "}
                <span className="text-muted">({conn.currency})</span>
              </p>
              <p className="text-xs text-muted">
                Última actualización: {conn.last_synced_at ? fmtDateTime(conn.last_synced_at) : "pendiente"}. Se
                actualiza sola todas las mañanas.
              </p>
              {conn.last_error && <p className="mt-1 text-xs text-bad">{conn.last_error}</p>}
              {expiresSoon && !conn.last_error && (
                <p className="mt-1 text-xs text-warn">La conexión vence pronto: reconectá para no cortar los datos.</p>
              )}
            </div>
            <div className="flex gap-2">
              <a href={connectHref} className="btn btn-sm">Reconectar</a>
              <form action={disconnectAds}>
                <input type="hidden" name="connection_id" value={conn.id} />
                <SubmitButton className="btn btn-sm" pendingText="...">Desconectar</SubmitButton>
              </form>
            </div>
          </>
        ) : (
          <>
            <div className="text-sm">
              <p className="font-medium">Conectá la cuenta publicitaria de esta sucursal</p>
              <p className="text-xs text-muted">
                El CRM solo lee métricas (gasto y resultados). No puede crear ni tocar anuncios.
              </p>
            </div>
            {metaConfigured() ? (
              <a href={connectHref} className="btn btn-primary">Conectar con Facebook</a>
            ) : (
              <span className="badge badge-gray">Falta configurar la app de Meta en el servidor</span>
            )}
          </>
        )}
      </section>

      {currencyMismatch && (
        <p className="alert-error">
          La cuenta publicitaria está en {conn!.currency} y la facturación en {cur}: el costo por paciente y el retorno no
          son comparables.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        <Kpi label="Inversión en Meta" value={fmtMoney(m.spend, cur)} />
        <Kpi
          label="Mensajes y formularios"
          value={fmtNumber(m.contacts)}
          hint={`${fmtMoney(m.costPerContact, cur)} cada uno`}
        />
        <Kpi
          label="Pacientes nuevas de redes"
          value={fmtNumber(m.social)}
          hint={`${fmtMoney(m.costPerPatient, cur)} cada una · ${m.total} nuevas en total`}
        />
        <Kpi
          label="Retorno"
          value={m.roas === null ? "—" : `${fmtNumber(m.roas, 1)}x`}
          hint={`${fmtMoney(m.revenue, cur)} facturados por esas pacientes`}
          accent
        />
      </div>

      <section className="space-y-2">
        <h2>Campañas</h2>
        <div className="card overflow-x-auto p-0">
          {campaigns.length === 0 ? (
            <p className="p-4 text-sm text-muted">
              {conn ? "Sin gasto en este período." : "Conectá la cuenta de Meta para ver las campañas."}
            </p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Campaña</th>
                  <th>Inversión</th>
                  <th>Impresiones</th>
                  <th>Clics</th>
                  <th>Mensajes</th>
                  <th>Formularios</th>
                  <th>Costo x resultado</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => {
                  const results = Number(c.messages) + Number(c.leads);
                  return (
                    <tr key={c.campaign_id}>
                      <td className="font-medium">{c.campaign_name ?? c.campaign_id}</td>
                      <td className="whitespace-nowrap">{fmtMoney(c.spend, conn?.currency ?? cur)}</td>
                      <td>{fmtNumber(Number(c.impressions))}</td>
                      <td>{fmtNumber(Number(c.clicks))}</td>
                      <td>{fmtNumber(Number(c.messages))}</td>
                      <td>{fmtNumber(Number(c.leads))}</td>
                      <td className="whitespace-nowrap">
                        {fmtMoney(ratio(Number(c.spend), results), conn?.currency ?? cur)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <p className="text-xs text-muted">
        Cómo se calcula: las pacientes «de redes» son las dadas de alta en el período que respondieron Instagram o
        Facebook en «¿Cómo nos conoció?». La relación es por sucursal y período, no anuncio por anuncio. Por eso es clave
        que recepción complete ese dato siempre.
      </p>
    </div>
  );
}

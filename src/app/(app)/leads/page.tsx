import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireBranchContext } from "@/lib/context";
import { fmtDate, fmtTime, todayISO, whatsappLink } from "@/lib/format";
import { leadsConfigured } from "@/lib/meta-leads";
import { bookLead, setLeadStatus } from "./actions";
import { LeadPageActions } from "./page-actions";
import { LeadWhatsAppButton } from "./whatsapp-button";

type Lead = {
  id: string;
  created_at: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  answers: { pregunta: string; respuesta: string }[];
  form_name: string | null;
  ad_name: string | null;
  campaign_name: string | null;
  platform: string | null;
  status: "new" | "contacted" | "booked" | "lost";
  patient_id: string | null;
  contacted_at: string | null;
};

const TABS = [
  { key: "new", label: "Sin contactar" },
  { key: "contacted", label: "Contactados" },
  { key: "booked", label: "Sacaron turno" },
  { key: "lost", label: "Descartados" },
] as const;

function ago(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ayer" : d < 7 ? `hace ${d} días` : fmtDate(iso);
}

// Lo que le interesa, para el mensaje: la respuesta a una pregunta sobre tratamiento/interés
function interest(l: Lead) {
  const a = l.answers.find((x) => /trat|inter|servic|zona|qu[eé] te/i.test(x.pregunta));
  return a?.respuesta || null;
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; error?: string; ok?: string }>;
}) {
  const ctx = await requireBranchContext();
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.estado) ? (sp.estado as Lead["status"]) : "new";
  const supabase = await createClient();
  const branchId = ctx.currentBranch.id;
  const monthStart = `${todayISO().slice(0, 7)}-01T00:00:00-03:00`;

  const [{ data: leadData }, { data: pages }, { data: counts }, { data: monthData }] = await Promise.all([
    supabase
      .from("leads")
      .select("id, created_at, full_name, phone, email, answers, form_name, ad_name, campaign_name, platform, status, patient_id, contacted_at")
      .eq("branch_id", branchId)
      .eq("status", tab)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("lead_pages").select("id, page_name, last_lead_at, last_error").eq("branch_id", branchId),
    supabase.from("leads").select("status").eq("branch_id", branchId).limit(5000),
    supabase
      .from("leads")
      .select("campaign_name, status")
      .eq("branch_id", branchId)
      .gte("created_at", new Date(monthStart).toISOString())
      .limit(5000),
  ]);

  const leads = (leadData ?? []) as Lead[];
  const countBy = (s: string) => (counts ?? []).filter((c) => c.status === s).length;
  const connected = (pages ?? []) as { id: string; page_name: string | null; last_lead_at: string | null; last_error: string | null }[];
  const brand = `${ctx.org.name} ${ctx.currentBranch.name}`;

  // Este mes, por campaña: cuántos leads y cuántos sacaron turno
  const byCampaign = new Map<string, { leads: number; booked: number }>();
  for (const l of (monthData ?? []) as { campaign_name: string | null; status: string }[]) {
    const k = l.campaign_name ?? "Sin campaña";
    const c = byCampaign.get(k) ?? { leads: 0, booked: 0 };
    c.leads++;
    if (l.status === "booked") c.booked++;
    byCampaign.set(k, c);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="page-head">
        <div>
          <h1>Leads</h1>
          <p className="page-sub">
            Personas que completaron un formulario de los anuncios de {ctx.currentBranch.name}. Todavía no son
            pacientes: lo son cuando sacan turno.
          </p>
        </div>
      </div>

      {sp.ok && <p className="alert-ok">{sp.ok}</p>}
      {sp.error && <p className="alert-error">{sp.error}</p>}

      {ctx.canManageCurrentBranch && (
        <section className="card flex flex-wrap items-center justify-between gap-3 text-sm">
          {connected.length ? (
            connected.map((p) => (
              <div key={p.id} className="flex w-full flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">Página conectada: {p.page_name}</p>
                  <p className={`text-xs ${p.last_error ? "text-bad" : "text-muted"}`}>
                    {p.last_error
                      ? `Último error: ${p.last_error}`
                      : p.last_lead_at
                        ? `Último lead ${ago(p.last_lead_at)}`
                        : "Los formularios nuevos llegan solos (se revisa cada 5 minutos)."}
                  </p>
                </div>
                <LeadPageActions id={p.id} name={p.page_name ?? "la página"} />
              </div>
            ))
          ) : (
            <>
              <div>
                <p className="font-semibold">Conectá la página de Facebook de la sucursal</p>
                <p className="text-xs text-muted">
                  Así cada formulario de los anuncios llega acá solo, sin descargar nada. Se traen también los de los
                  últimos 30 días.
                </p>
              </div>
              {leadsConfigured() ? (
                <a href={`/api/meta/leads/connect?branch=${branchId}`} className="btn btn-primary">
                  Conectar con Facebook
                </a>
              ) : (
                <span className="text-xs text-muted">Falta configurar la app de Meta en el servidor.</span>
              )}
            </>
          )}
        </section>
      )}

      <nav className="flex flex-wrap gap-1 rounded-full bg-subtle p-1 text-sm font-semibold" aria-label="Estado">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/leads?estado=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={`rounded-full px-3 py-1.5 ${tab === t.key ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}
          >
            {t.label} <span className="num font-normal text-muted">{countBy(t.key)}</span>
          </Link>
        ))}
      </nav>

      {leads.length === 0 ? (
        <div className="card text-sm text-muted">
          {tab === "new" ? "No hay leads sin contactar. Los nuevos aparecen acá apenas completan el formulario." : "Nada por acá."}
        </div>
      ) : (
        <ul className="card divide-y divide-line p-0">
          {leads.map((l) => {
            const first = (l.full_name ?? "").split(" ")[0] || "";
            const what = interest(l);
            const message = `Hola${first ? ` ${first}` : ""}! Te escribimos de ${brand} por tu consulta${
              what ? ` sobre ${what}` : ""
            }. ¿Querés que te pasemos días y horarios para tu turno?`;
            return (
              <li key={l.id} className="grid gap-3 px-4 py-4 sm:grid-cols-[1fr_auto] sm:items-start">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[0.98rem] font-semibold">{l.full_name ?? "Sin nombre"}</span>
                    <span className="text-xs text-muted">
                      {ago(l.created_at)} · {fmtTime(l.created_at)}
                    </span>
                    {l.patient_id && (
                      <Link href={`/pacientes/${l.patient_id}`} className="badge badge-green hover:underline">
                        Ya es paciente
                      </Link>
                    )}
                  </div>
                  <p className="text-sm text-muted">
                    {[l.phone ? `+${l.phone}` : null, l.email].filter(Boolean).join(" · ") || "Sin datos de contacto"}
                  </p>
                  {l.answers.length > 0 && (
                    <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
                      {l.answers.map((a, i) => (
                        <div key={i} className="flex gap-1">
                          <dt className="text-muted">{a.pregunta}:</dt>
                          <dd className="font-medium">{a.respuesta}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <p className="text-xs text-muted">
                    {[l.platform === "ig" ? "Instagram" : l.platform === "fb" ? "Facebook" : null, l.campaign_name, l.ad_name]
                      .filter(Boolean)
                      .join(" · ") || l.form_name}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  {l.phone && l.status !== "booked" && (
                    <LeadWhatsAppButton id={l.id} href={whatsappLink(l.phone, message)} primary={l.status === "new"} />
                  )}
                  {l.status !== "booked" && (
                    <form action={bookLead}>
                      <input type="hidden" name="id" value={l.id} />
                      <button className={`btn btn-sm ${l.status === "contacted" ? "btn-primary" : ""}`}>Darle turno</button>
                    </form>
                  )}
                  {l.status === "new" || l.status === "contacted" ? (
                    <form action={setLeadStatus}>
                      <input type="hidden" name="id" value={l.id} />
                      <input type="hidden" name="status" value="lost" />
                      <button className="text-xs text-muted hover:text-bad">Descartar</button>
                    </form>
                  ) : l.status === "lost" ? (
                    <form action={setLeadStatus}>
                      <input type="hidden" name="id" value={l.id} />
                      <input type="hidden" name="status" value="contacted" />
                      <button className="text-xs text-muted hover:text-ink">Recuperar</button>
                    </form>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {byCampaign.size > 0 && (
        <section className="space-y-2">
          <h2>Este mes, por campaña</h2>
          <div className="card overflow-x-auto p-0">
            <table className="table">
              <thead>
                <tr>
                  <th>Campaña</th>
                  <th className="text-right">Leads</th>
                  <th className="text-right">Sacaron turno</th>
                  <th className="text-right">Conversión</th>
                </tr>
              </thead>
              <tbody>
                {[...byCampaign.entries()]
                  .sort((a, b) => b[1].leads - a[1].leads)
                  .map(([name, c]) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td className="num text-right">{c.leads}</td>
                      <td className="num text-right">{c.booked}</td>
                      <td className="num text-right">{Math.round((c.booked / c.leads) * 100)}%</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

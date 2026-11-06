import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireBranchContext } from "@/lib/context";
import { fmtDate, fmtTime, todayISO, whatsappLink } from "@/lib/format";
import { leadsConfigured } from "@/lib/meta-leads";
import { bookLead, setLeadStatus } from "./actions";
import { LeadPageActions } from "./page-actions";
import { LeadUndoProvider } from "./undo";
import { LeadWhatsAppButton } from "./whatsapp-button";

type Lead = {
  id: string;
  created_at: string;
  updated_at: string;
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
  contacted_by: string | null;
  contacted_by_email: string | null;
  contact_count: number;
};

const LEAD_FIELDS =
  "id, created_at, updated_at, full_name, phone, email, answers, form_name, ad_name, campaign_name, platform, status, patient_id, contacted_at, contacted_by, contacted_by_email, contact_count";

// Sin turno a los 2 días de escribirle: se marca para volver a escribirle
const FOLLOW_UP_MS = 2 * 86_400_000;

function ago(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ayer" : d < 7 ? `hace ${d} días` : fmtDate(iso);
}

const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

// Lo que le interesa, para el mensaje: la respuesta a una pregunta sobre tratamiento/interés
function interest(l: Lead) {
  const a = l.answers.find((x) => /trat|inter|servic|zona|qu[eé] te/i.test(x.pregunta));
  return a?.respuesta || null;
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const ctx = await requireBranchContext();
  const sp = await searchParams;
  const supabase = await createClient();
  const branchId = ctx.currentBranch.id;
  const monthStart = `${todayISO().slice(0, 7)}-01T00:00:00-03:00`;

  const byStatus = (status: Lead["status"], order: "created_at" | "contacted_at" | "updated_at", limit: number) =>
    supabase
      .from("leads")
      .select(LEAD_FIELDS)
      .eq("branch_id", branchId)
      .eq("status", status)
      .order(order, { ascending: order === "contacted_at" })
      .limit(limit);

  const [newRes, contactedRes, bookedRes, lostRes, { data: pages }, { data: counts }, { data: monthData }] =
    await Promise.all([
      byStatus("new", "created_at", 200),
      byStatus("contacted", "contacted_at", 200),
      byStatus("booked", "updated_at", 50),
      byStatus("lost", "updated_at", 50),
      supabase.from("lead_pages").select("id, page_name, last_lead_at, last_error").eq("branch_id", branchId),
      supabase.from("leads").select("status").eq("branch_id", branchId).limit(5000),
      supabase
        .from("leads")
        .select("campaign_name, status")
        .eq("branch_id", branchId)
        .gte("created_at", new Date(monthStart).toISOString())
        .limit(5000),
    ]);

  const fresh = (newRes.data ?? []) as Lead[];
  const contacted = (contactedRes.data ?? []) as Lead[];
  const booked = (bookedRes.data ?? []) as Lead[];
  const lost = (lostRes.data ?? []) as Lead[];
  // Primero los que ya pasaron 2 días sin respuesta (el más viejo arriba), después el resto
  const due = contacted.filter((l) => l.contacted_at && Date.now() - new Date(l.contacted_at).getTime() >= FOLLOW_UP_MS);
  const waiting = contacted.filter((l) => !due.includes(l)).reverse();

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

  // «Le escribiste» / «Le escribió marian»
  const wrote = (l: Lead) =>
    l.contacted_by === ctx.userId
      ? "Le escribiste"
      : `Le escribió ${l.contacted_by_email?.split("@")[0] ?? "alguien del equipo"}`;

  const firstName = (l: Lead) => (l.full_name ?? "").split(" ")[0] || "";
  const firstMessage = (l: Lead) => {
    const what = interest(l);
    return `Hola${firstName(l) ? ` ${firstName(l)}` : ""}! Te escribimos de ${brand} por tu consulta${
      what ? ` sobre ${what}` : ""
    }. ¿Querés que te pasemos días y horarios para tu turno?`;
  };
  const followUpMessage = (l: Lead) => {
    const what = interest(l);
    return `Hola${firstName(l) ? ` ${firstName(l)}` : ""}! Te escribo de nuevo de ${brand} por tu consulta${
      what ? ` sobre ${what}` : ""
    }. ¿Te sigue interesando? Si querés te paso los turnos que tenemos esta semana.`;
  };

  const row = (l: Lead, mode: "new" | "due" | "waiting" | "history") => (
      <li key={l.id} className="grid gap-3 px-4 py-4 sm:grid-cols-[1fr_auto] sm:items-start">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[0.98rem] font-semibold">{l.full_name ?? "Sin nombre"}</span>{" "}
            <span className="text-xs text-muted">
              · {ago(l.created_at)} {fmtTime(l.created_at)}
            </span>{" "}
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
            <dl className="space-y-0.5 text-sm">
              {l.answers.map((a, i) => (
                <div key={i}>
                  <dt className="inline text-muted">{a.pregunta}:</dt>{" "}
                  <dd className="inline font-medium">{a.respuesta}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="text-xs text-muted">
            {[l.platform === "ig" ? "Instagram" : l.platform === "fb" ? "Facebook" : null, l.campaign_name, l.ad_name]
              .filter(Boolean)
              .join(" · ") || l.form_name}
          </p>
          {(mode === "due" || mode === "waiting") && l.contacted_at && (
            <p className={`text-sm ${mode === "due" ? "font-semibold text-bad" : "text-muted"}`}>
              {mode === "due"
                ? `Sin respuesta hace ${daysSince(l.contacted_at)} días · volvé a escribirle`
                : `${wrote(l)} ${ago(l.contacted_at)}`}
              {l.contact_count > 1 && ` · ${l.contact_count} mensajes`}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {l.phone && mode !== "history" && (
            <LeadWhatsAppButton
              id={l.id}
              name={firstName(l) || "este lead"}
              href={whatsappLink(l.phone, mode === "new" ? firstMessage(l) : followUpMessage(l))}
              label={mode === "new" ? "Escribirle" : "Volver a escribir"}
              primary={mode === "new" || mode === "due"}
            />
          )}
          {l.status !== "booked" && (
            <form action={bookLead}>
              <input type="hidden" name="id" value={l.id} />
              <button className={`btn btn-sm ${mode === "waiting" ? "btn-primary" : ""}`}>Darle turno</button>
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

  return (
    <LeadUndoProvider>
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

        <section className="space-y-2">
          <h2>
            Sin contactar <span className="num font-normal text-muted">{countBy("new")}</span>
          </h2>
          {fresh.length === 0 ? (
            <div className="card text-sm text-muted">
              No hay leads sin contactar. Los nuevos aparecen acá apenas completan el formulario.
            </div>
          ) : (
            <ul className="card divide-y divide-line p-0">
              {fresh.map((l) => (
                row(l, "new")
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h2>
            Escritos · esperando respuesta <span className="num font-normal text-muted">{countBy("contacted")}</span>
          </h2>
          {contacted.length === 0 ? (
            <div className="card text-sm text-muted">
              Cuando le escribas a alguien por WhatsApp pasa acá, hasta que saque turno o lo descartes.
            </div>
          ) : (
            <ul className="card divide-y divide-line p-0">
              {due.map((l) => (
                row(l, "due")
              ))}
              {waiting.map((l) => (
                row(l, "waiting")
              ))}
            </ul>
          )}
        </section>

        {(booked.length > 0 || lost.length > 0) && (
          <section className="space-y-2">
            {[
              { title: "Sacaron turno", list: booked, total: countBy("booked") },
              { title: "Descartados", list: lost, total: countBy("lost") },
            ]
              .filter((g) => g.list.length > 0)
              .map((g) => (
                <details key={g.title} className="card fold p-0">
                  <summary className="fold-summary px-4 py-3">
                    <span className="font-semibold">
                      {g.title} <span className="num font-normal text-muted">{g.total}</span>
                    </span>
                    <svg
                      viewBox="0 0 24 24"
                      className="fold-chevron h-5 w-5 shrink-0 text-muted"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    >
                      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </summary>
                  <ul className="divide-y divide-line border-t border-line">
                    {g.list.map((l) => (
                      row(l, "history")
                    ))}
                  </ul>
                </details>
              ))}
          </section>
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
    </LeadUndoProvider>
  );
}

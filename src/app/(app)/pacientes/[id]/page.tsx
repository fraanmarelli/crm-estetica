import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireBranchContext } from "@/lib/context";
import {
  TZ,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  fmtTime,
  fullName,
  todayISO,
  whatsappLink,
  STATUS_CLASS,
  STATUS_LABEL,
} from "@/lib/format";
import type { AppointmentStatus, Patient } from "@/lib/types";
import { ClinicalBackground, type Background } from "./clinical-background";
import { NoteComposer } from "./note-composer";
import { SoonButton, SoonCard } from "@/components/soon";
import { PatientNotes } from "./patient-notes";
import { PatientEditForm } from "./patient-edit-form";
import { PointsForm } from "./points-form";

type Appt = {
  id: string;
  branch_id: string;
  scheduled_at: string;
  status: AppointmentStatus;
  amount_paid: number | null;
  payment_method: string | null;
  notes: string | null;
  branch: { name: string } | null;
  professional: { full_name: string } | null;
  items: {
    zone: string | null;
    quantity: number | null;
    lot_code: string | null;
    treatment: { id: string; name: string; unit_label: string | null; recall_days: number | null } | null;
  }[];
};

type Note = { id: string; appointment_id: string | null; body: string; author_name: string | null; created_at: string };

const localDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
const daysBetween = (fromIsoDate: string, toIsoDate: string) =>
  Math.round((Date.parse(`${toIsoDate}T12:00:00Z`) - Date.parse(`${fromIsoDate}T12:00:00Z`)) / 86_400_000);
const addDays = (isoDate: string, n: number) =>
  new Date(Date.parse(`${isoDate}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const shortDay = (isoDate: string) =>
  new Date(`${isoDate}T12:00:00-03:00`).toLocaleDateString("es-AR", { timeZone: TZ, day: "numeric", month: "numeric" });
const weekdayDay = (iso: string) =>
  new Date(iso).toLocaleDateString("es-AR", { timeZone: TZ, weekday: "long", day: "numeric", month: "numeric" });
const monthYear = (iso: string) =>
  new Date(iso).toLocaleDateString("es-AR", { timeZone: TZ, month: "long", year: "numeric" });

const qty = (n: number | null, unit: string | null) =>
  n === null ? null : `${String(n).replace(".", ",")}${unit ? ` ${unit}` : ""}`;
// Mismo tratamiento y mismo lote en un renglón: «Botox  Frente 20 U, Entrecejo 15 U  Lote C3456A»
function groupItems(items: Appt["items"]) {
  const groups = new Map<string, { key: string; name: string; parts: string[]; lot: string | null }>();
  for (const i of items) {
    const name = i.treatment?.name ?? "Tratamiento";
    const key = `${name}|${i.lot_code ?? ""}`;
    const g = groups.get(key) ?? { key, name, parts: [], lot: i.lot_code };
    const part = [i.zone, qty(i.quantity, i.treatment?.unit_label ?? null)].filter(Boolean).join(" ");
    if (part) g.parts.push(part);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({ ...g, detail: g.parts.join(", ") }));
}
const treatmentsLabel = (a: Appt) =>
  [...new Set(a.items.map((i) => i.treatment?.name).filter(Boolean))].join(" + ") || "Sin tratamiento cargado";
const noteMeta = (n: Note) => `${n.author_name ?? "Equipo"}, ${fmtDateTime(n.created_at)}`;

// 5491133432864 → +54 9 11 3343-2864 (CABA); otras áreas: +54 9 351 555-1234 aprox. (el número queda entero)
function fmtPhone(raw: string): string {
  const m = /^549(11)(\d{4})(\d{4})$/.exec(raw);
  if (m) return `+54 9 ${m[1]} ${m[2]}-${m[3]}`;
  const r = /^549(\d+)(\d{4})$/.exec(raw);
  return r ? `+54 9 ${r[1]}-${r[2]}` : `+${raw}`;
}

function age(birth: string | null): number | null {
  if (!birth) return null;
  const [y, m, d] = birth.split("-").map(Number);
  const [ty, tm, td] = todayISO().split("-").map(Number);
  let a = ty - y;
  if (tm < m || (tm === m && td < d)) a--;
  return a >= 0 && a < 120 ? a : null;
}

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireBranchContext();
  const { id } = await params;
  const supabase = await createClient();

  // Todo junto, en una sola vuelta a la base (si no hay ficha, lo demás vuelve vacío)
  const [
    { data: patient },
    { data: appts },
    { data: balance },
    { data: moves },
    { data: notesData },
    { data: bgData },
    { data: finData },
    { data: recallOverrides },
  ] = await Promise.all([
    supabase
      .from("patients")
      .select("*, home_branch:branches(name)")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("appointments")
      .select(
        "id, branch_id, scheduled_at, status, amount_paid, payment_method, notes, branch:branches(name), professional:professionals(full_name), items:appointment_items(zone, quantity, lot_code, treatment:treatments(id, name, unit_label, recall_days))",
      )
      .eq("patient_id", id)
      .order("scheduled_at", { ascending: false }),
    supabase.from("patient_loyalty_balance").select("balance").eq("patient_id", id).maybeSingle(),
    supabase
      .from("loyalty_transactions")
      .select("id, points, reason, created_at")
      .eq("patient_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
    // Historia clínica: solo profesionales, franquiciado y marca (la base filtra igual)
    ctx.canViewClinical
      ? supabase
          .from("clinical_notes")
          .select("id, appointment_id, body, author_name, created_at")
          .eq("patient_id", id)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as Note[] }),
    ctx.canViewClinical
      ? supabase
          .from("clinical_background")
          .select("allergies, medications, conditions, previous_treatments, updated_by_name, updated_at")
          .eq("patient_id", id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // Lo que dejó: solo quien ve costos (la base no devuelve nada a recepción ni a profesionales)
    ctx.canManageCurrentBranch
      ? supabase.rpc("patient_financials", { p_patient: id })
      : Promise.resolve({ data: null }),
    // Recall: lo que cada sucursal cambió del catálogo (Ajustes → Recall)
    supabase.from("branch_recall_days").select("branch_id, treatment_id, recall_days").eq("organization_id", ctx.org.id),
  ]);
  if (!patient) {
    // Puede existir en otra sucursal sin acceso a la ficha completa
    const { data: brief } = await supabase.rpc("patient_brief", { p_patient: id });
    if (!brief?.length) notFound();
    return (
      <div className="card mx-auto max-w-md space-y-3">
        <h1>{brief[0].display_name}</h1>
        <p className="text-sm text-muted">
          Es paciente de otra sucursal. Al darle un turno en {ctx.currentBranch.name} vas a ver su ficha.
        </p>
        <Link href={`/turnos/nuevo?paciente=${id}`} className="btn btn-primary">Darle un turno</Link>
      </div>
    );
  }

  const p = patient as Patient & { home_branch: { name: string } | null };
  const readOnly = ctx.isProfessionalOnly;
  // La profesional no ve montos
  const showMoney = !ctx.isProfessionalOnly;
  const cur = ctx.org.currency;
  const today = todayISO();
  const fin = ((finData ?? []) as { visits: number; revenue: number; supplies: number; commission: number; net: number }[])[0];

  const notes = (notesData ?? []) as Note[];
  const notesByAppt = new Map<string, Note[]>();
  for (const n of notes) {
    if (n.appointment_id) notesByAppt.set(n.appointment_id, [...(notesByAppt.get(n.appointment_id) ?? []), n]);
  }

  // Turnos: hoy (abierto), próximos y pasados (plegados)
  const history = (appts ?? []) as unknown as Appt[];
  const todays = history
    .filter((a) => localDay(a.scheduled_at) === today && a.status !== "cancelled")
    .sort((x, y) => (x.scheduled_at < y.scheduled_at ? -1 : 1));
  const upcoming = history
    .filter((a) => localDay(a.scheduled_at) > today && a.status === "scheduled")
    .sort((x, y) => (x.scheduled_at < y.scheduled_at ? -1 : 1));
  const past = history.filter((a) => localDay(a.scheduled_at) < today || (localDay(a.scheduled_at) === today && a.status === "cancelled"));
  const sessions = history.filter((a) => a.status === "completed"); // la más reciente primero
  const pastDone = past.filter((a) => a.status === "completed");

  // Sin turno por delante: cuándo le toca volver (el recall más cercano de lo que se hizo)
  // Los días son los de la sucursal donde se lo hizo (si los cambió) o los del catálogo
  const branchDays = new Map(
    ((recallOverrides ?? []) as { branch_id: string; treatment_id: string; recall_days: number | null }[]).map((o) => [
      `${o.branch_id}:${o.treatment_id}`,
      o.recall_days,
    ]),
  );
  const lastByTreatment = new Map<string, { name: string; at: string; days: number }>();
  for (const a of sessions) {
    for (const i of a.items) {
      const t = i.treatment;
      if (!t || lastByTreatment.has(t.name)) continue;
      const key = `${a.branch_id}:${t.id}`;
      const days = branchDays.has(key) ? branchDays.get(key) : t.recall_days;
      // El último de ese tratamiento manda: si en esa sucursal no tiene recall, no se busca uno más viejo
      lastByTreatment.set(t.name, { name: t.name, at: localDay(a.scheduled_at), days: days ?? 0 });
    }
  }
  const nextRecall = [...lastByTreatment.values()]
    .filter((t) => t.days > 0)
    .map((t) => ({ name: t.name, due: addDays(t.at, t.days) }))
    .sort((x, y) => (x.due < y.due ? -1 : 1))[0];

  const totalSpent = sessions.reduce((s, a) => s + Number(a.amount_paid ?? 0), 0);
  const years = age(p.birth_date);
  const canWrite = !readOnly && !p.marketing_opt_out_at && !!p.phone;

  const bg = (bgData ?? null) as Background | null;
  const allergy = bg?.allergies && !/^(ninguna?|no|no tiene|sin)\b/i.test(bg.allergies.trim()) ? bg.allergies : null;
  const bgCount = bg ? [bg.allergies, bg.medications, bg.conditions, bg.previous_treatments].filter(Boolean).length : 0;

  // Un turno en una línea: cuándo, qué (con zona y lote), quién y cuánto o el estado
  const row = (a: Appt, when: string) => {
    const groups = groupItems(a.items);
    const detail = groups.map((g) => g.detail).filter(Boolean).join(", ");
    const lots = [...new Set(groups.map((g) => g.lot).filter(Boolean))].join(", ");
    const n = notesByAppt.get(a.id)?.length ?? 0;
    return (
      <li key={a.id}>
        <Link
          href={`/turnos/${a.id}`}
          className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 px-4 py-3 hover:bg-subtle/60"
        >
          <span className="num text-sm text-muted">{when}</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{treatmentsLabel(a)}</span>
            <span className="block truncate text-xs text-muted">
              {[detail, lots && `lote ${lots}`, a.professional?.full_name, n ? (n === 1 ? "1 nota" : `${n} notas`) : ""]
                .filter(Boolean)
                .join(", ")}
            </span>
          </span>
          {a.status === "completed" && showMoney ? (
            <span className="num whitespace-nowrap text-sm">{fmtMoney(a.amount_paid, cur)}</span>
          ) : a.status === "completed" ? (
            <span aria-hidden="true" className="text-muted">›</span>
          ) : (
            <span className={STATUS_CLASS[a.status]}>{STATUS_LABEL[a.status]}</span>
          )}
        </Link>
      </li>
    );
  };

  return (
    <div className="space-y-5">
      {/* Quién es */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <h1>{fullName(p)}</h1>
          <p className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted">
            {p.phone && <span className="num">{fmtPhone(p.phone)}</span>}
            {years !== null && <span>{years} años</span>}
            <span>Paciente desde {monthYear(p.created_at)}</span>
            {p.home_branch && p.home_branch.name !== ctx.currentBranch.name && <span>De {p.home_branch.name}</span>}
          </p>
          <div className="flex flex-wrap gap-1">
            {!p.consent_data_at &&
              (readOnly ? (
                <span className="badge badge-amber">Ficha incompleta</span>
              ) : (
                <Link href={`/pacientes/${p.id}/completar`} className="badge badge-amber hover:underline">
                  Ficha incompleta: completar
                </Link>
              ))}
            {p.marketing_opt_out_at ? (
              <span className="badge badge-red">No contactar</span>
            ) : p.consent_marketing_at ? (
              <span className="badge badge-green">Acepta recordatorios</span>
            ) : (
              <span className="badge badge-amber">Sin consentimiento de recordatorios</span>
            )}
          </div>
        </div>
        {!readOnly && (
          <div className="flex gap-2">
            {canWrite && (
              <a href={whatsappLink(p.phone!, `Hola ${p.first_name}!`)} target="_blank" rel="noopener noreferrer" className="btn">
                WhatsApp
              </a>
            )}
            <Link href={`/turnos/nuevo?paciente=${p.id}`} className="btn btn-primary">Nuevo turno</Link>
          </div>
        )}
      </div>

      <PatientNotes patientId={p.id} notes={p.notes} canEdit={!readOnly} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-3">
          {/* Turnos: hoy, próximos, pasados */}
          <section className="card p-0">
            <h2 className="px-4 pb-1 pt-4">Turnos</h2>

            {todays.length > 0 && (
              <div className="px-4 pb-3">
                <p className="mb-2 text-xs font-semibold text-brand">Hoy</p>
                <ul className="space-y-2">
                  {todays.map((a) => (
                    <li
                      key={a.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-subtle px-4 py-3"
                    >
                      <div className="flex min-w-0 items-baseline gap-4">
                        <span className="num text-xl font-semibold leading-none">{fmtTime(a.scheduled_at)}</span>
                        <span className="min-w-0">
                          <span className="block font-semibold">{treatmentsLabel(a)}</span>
                          <span className="block text-xs text-muted">
                            {a.professional ? `Con ${a.professional.full_name}` : "Sin médico/a asignado"}
                          </span>
                        </span>
                      </div>
                      {a.status === "scheduled" && !readOnly ? (
                        <Link href={`/turnos/${a.id}?cobrar=1`} className="btn btn-primary btn-sm">Registrar atención</Link>
                      ) : a.status === "completed" ? (
                        <Link href={`/turnos/${a.id}`} className="btn btn-sm">
                          Atendida{showMoney ? `, ${fmtMoney(a.amount_paid, cur)}` : ""}
                        </Link>
                      ) : (
                        <span className={STATUS_CLASS[a.status]}>{STATUS_LABEL[a.status]}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {todays.length === 0 && upcoming.length === 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3">
                <p className="min-w-0 text-sm">
                  {nextRecall && nextRecall.due <= today ? (
                    <>
                      <span className="font-semibold text-warn">Le toca volver</span>{" "}
                      <span className="text-muted">
                        a {nextRecall.name} desde el {shortDay(nextRecall.due)} (hace {daysBetween(nextRecall.due, today)}{" "}
                        días)
                      </span>
                    </>
                  ) : nextRecall ? (
                    <span className="text-muted">
                      Sin turnos por delante. Le toca volver a {nextRecall.name} el {shortDay(nextRecall.due)}.
                    </span>
                  ) : (
                    <span className="text-muted">Sin turnos por delante.</span>
                  )}
                </p>
                {!readOnly && <Link href={`/turnos/nuevo?paciente=${p.id}`} className="btn btn-sm">Agendar</Link>}
              </div>
            )}

            {upcoming.length > 0 && (
              <details className="fold border-t border-line">
                <summary className="fold-summary px-4 py-3 text-sm">
                  <span className="font-semibold">
                    Próximos <span className="num font-normal text-muted">{upcoming.length}</span>
                  </span>
                  <span className="text-xs text-muted">
                    {weekdayDay(upcoming[0].scheduled_at)} a las {fmtTime(upcoming[0].scheduled_at)}
                  </span>
                </summary>
                <ul className="divide-y divide-line border-t border-line">
                  {upcoming.map((a) => row(a, `${shortDay(localDay(a.scheduled_at))} ${fmtTime(a.scheduled_at)}`))}
                </ul>
              </details>
            )}

            {past.length > 0 && (
              <details className="fold border-t border-line">
                <summary className="fold-summary px-4 py-3 text-sm">
                  <span className="font-semibold">
                    Pasados <span className="num font-normal text-muted">{past.length}</span>
                  </span>
                  <span className="text-xs text-muted">
                    {pastDone.length === 1 ? "1 atendido" : `${pastDone.length} atendidos`}
                    {pastDone[0] ? `, el último el ${fmtDate(pastDone[0].scheduled_at)}` : ""}
                  </span>
                </summary>
                <ul className="divide-y divide-line border-t border-line">
                  {past.map((a) => row(a, fmtDate(a.scheduled_at)))}
                </ul>
              </details>
            )}

            {history.length === 0 && (
              <p className="px-4 pb-4 text-sm text-muted">Todavía no tiene turnos.</p>
            )}
          </section>

          {/* Salud (antecedentes): plegada; la alergia se ve sin abrir */}
          {ctx.canViewClinical && (
            <details className="card fold p-0">
              <summary className="fold-summary px-4 py-3 text-sm">
                <span className="font-semibold">Salud</span>
                {allergy ? (
                  <span className="min-w-0 truncate rounded-md bg-bad-soft px-2 py-0.5 text-xs font-semibold text-bad">
                    Alergia: {allergy}
                  </span>
                ) : (
                  <span className="text-xs text-muted">
                    {bgCount ? (bg?.allergies ? "Sin alergias" : "Antecedentes cargados") : "Sin antecedentes cargados"}
                  </span>
                )}
              </summary>
              <div className="border-t border-line px-4 py-4">
                <ClinicalBackground patientId={p.id} data={bg} />
              </div>
            </details>
          )}

          {/* Notas clínicas: plegadas */}
          {ctx.canViewClinical && (
            <details className="card fold p-0">
              <summary className="fold-summary px-4 py-3 text-sm">
                <span className="font-semibold">
                  Notas clínicas <span className="num font-normal text-muted">{notes.length || ""}</span>
                </span>
                <span className="text-xs text-muted">
                  {notes[0] ? `La última el ${fmtDate(notes[0].created_at)}` : "No la ve recepción"}
                </span>
              </summary>
              <div className="space-y-3 border-t border-line px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted">Solo la ven las profesionales, el franquiciado y la marca.</p>
                  <NoteComposer
                    patientId={p.id}
                    sessions={sessions.map((a) => ({ id: a.id, label: `${treatmentsLabel(a)} · ${fmtDate(a.scheduled_at)}` }))}
                  />
                </div>
                {ctx.showRoadmap && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <SoonCard
                      title="Consentimiento informado"
                      description="Cláusulas de cada tratamiento y firma en pantalla, guardado con fecha y versión del texto."
                    />
                    <SoonCard title="Fotos antes / después" description="En cada sesión, privadas, para comparar la evolución." />
                  </div>
                )}
                {notes.length === 0 ? (
                  <p className="text-sm text-muted">Sin notas todavía.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {notes.map((n) => {
                      const s = n.appointment_id ? sessions.find((a) => a.id === n.appointment_id) : null;
                      return (
                        <li key={n.id} className="space-y-1 py-3 first:pt-0 last:pb-0">
                          <p className="whitespace-pre-line text-sm">{n.body}</p>
                          <p className="text-xs text-muted">
                            {noteMeta(n)}
                            {s && (
                              <>
                                {", "}
                                <Link href={`/turnos/${s.id}`} className="hover:text-ink hover:underline">
                                  {treatmentsLabel(s)} del {fmtDate(s.scheduled_at)}
                                </Link>
                              </>
                            )}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </details>
          )}

          {/* Como paciente: plegado; lo que dejó se ve sin abrir */}
          <details className="card fold p-0">
            <summary className="fold-summary px-4 py-3 text-sm">
              <span className="font-semibold">Como paciente</span>
              <span className="text-xs text-muted">
                {sessions.length === 1 ? "1 visita" : `${sessions.length} visitas`}
                {fin ? `, dejó ${fmtMoney(fin.net, cur)}` : showMoney && sessions.length ? `, ${fmtMoney(totalSpent, cur)}` : ""}
              </span>
            </summary>
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-2 border-t border-line px-4 py-4 text-sm">
              <dt className="text-muted">Visitas atendidas</dt>
              <dd className="num">{sessions.length}</dd>
              {sessions.length > 0 && (
                <>
                  <dt className="text-muted">Primera visita</dt>
                  <dd className="num">{fmtDate(sessions[sessions.length - 1].scheduled_at)}</dd>
                  <dt className="text-muted">Última visita</dt>
                  <dd className="num">{fmtDate(sessions[0].scheduled_at)}</dd>
                </>
              )}
              {showMoney && (
                <>
                  <dt className="text-muted">Facturado</dt>
                  <dd className="num">{fmtMoney(totalSpent, cur)}</dd>
                  {sessions.length > 0 && (
                    <>
                      <dt className="text-muted">Por visita</dt>
                      <dd className="num">{fmtMoney(Math.round(totalSpent / sessions.length), cur)}</dd>
                    </>
                  )}
                </>
              )}
              {fin && (
                <>
                  <dt className="text-muted">Insumos</dt>
                  <dd className="num">{fin.supplies > 0 ? "−" : ""}{fmtMoney(fin.supplies, cur)}</dd>
                  <dt className="text-muted">Comisiones</dt>
                  <dd className="num">{fin.commission > 0 ? "−" : ""}{fmtMoney(fin.commission, cur)}</dd>
                  <dt className="border-t border-line pt-2 font-semibold">Lo que dejó</dt>
                  <dd className="num border-t border-line pt-2 font-semibold">{fmtMoney(fin.net, cur)}</dd>
                </>
              )}
              <dt className="text-muted">Nos conoció por</dt>
              <dd>{p.source ?? "Sin cargar"}</dd>
              <dt className="text-muted">Sucursal de origen</dt>
              <dd>{p.home_branch?.name ?? "Sin cargar"}</dd>
            </dl>
          </details>
        </div>

        {/* Columna derecha: Pasaporte y Datos */}
        <aside className="space-y-6">
          <section className="passport">
            <p className="text-sm opacity-80">Pasaporte de Belleza</p>
            <p className="gold-text mt-1 font-display text-5xl leading-none num">{balance?.balance ?? 0}</p>
            <p className="text-sm opacity-80">Beauty Millas disponibles</p>
            {moves && moves.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs">
                {moves.slice(0, 4).map((m) => (
                  <li key={m.id} className="flex justify-between gap-2 opacity-90">
                    <span className="truncate">
                      {fmtDate(m.created_at)} · {m.reason}
                    </span>
                    <span className="num font-semibold">{m.points > 0 ? `+${m.points}` : m.points}</span>
                  </li>
                ))}
              </ul>
            )}
            {ctx.showRoadmap && (
              <div className="mt-3">
                <SoonButton label="Mandarle su saldo por WhatsApp" />
              </div>
            )}
            {!readOnly && (
              <div className="passport-stub">
                <div className="rounded-xl bg-surface p-3 text-ink">
                  <PointsForm patientId={p.id} />
                </div>
              </div>
            )}
          </section>

          <section className="card space-y-3">
            <h2>Datos</h2>
            {readOnly ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                {[
                  ["Celular", p.phone ? fmtPhone(p.phone) : null],
                  ["DNI", p.dni],
                  ["Email", p.email],
                  ["Nacimiento", p.birth_date ? fmtDate(`${p.birth_date}T12:00:00-03:00`) : null],
                ].map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted">{k}</dt>
                    <dd className="min-w-0 break-words">{v || "Sin cargar"}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <PatientEditForm patient={p} />
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

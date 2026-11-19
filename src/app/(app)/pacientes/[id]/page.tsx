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
import { Tabs, type TabItem } from "@/components/tabs";
import { ClinicalBackground, type Background } from "./clinical-background";
import { NoteComposer } from "./note-composer";
import { SoonButton, SoonCard } from "@/components/soon";
import { PatientNotes } from "./patient-notes";
import { PatientEditForm } from "./patient-edit-form";
import { PointsForm } from "./points-form";

type Appt = {
  id: string;
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
    treatment: { name: string; unit_label: string | null; recall_days: number | null } | null;
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
const ago = (days: number) => (days === 0 ? "Hoy" : days === 1 ? "Ayer" : days < 60 ? `Hace ${days} días` : `Hace ${Math.round(days / 30)} meses`);

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
  const [{ data: patient }, { data: appts }, { data: balance }, { data: moves }, { data: notesData }, { data: bgData }] = await Promise.all([
    supabase
      .from("patients")
      .select("*, home_branch:branches(name)")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("appointments")
      .select(
        "id, scheduled_at, status, amount_paid, payment_method, notes, branch:branches(name), professional:professionals(full_name), items:appointment_items(zone, quantity, lot_code, treatment:treatments(name, unit_label, recall_days))",
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
  // La profesional no ve montos (cobros, gasto, ticket)
  const showMoney = !ctx.isProfessionalOnly;
  const cur = ctx.org.currency;
  const today = todayISO();

  const notes = (notesData ?? []) as Note[];
  const notesByAppt = new Map<string, Note[]>();
  for (const n of notes) {
    if (n.appointment_id) notesByAppt.set(n.appointment_id, [...(notesByAppt.get(n.appointment_id) ?? []), n]);
  }

  const history = (appts ?? []) as unknown as Appt[];
  const sessions = history.filter((a) => a.status === "completed"); // la más reciente primero
  const others = history.filter((a) => a.status !== "completed");
  const last = sessions[0] ?? null;
  // En «Última vez» solo la nota de esa visita (o una suelta posterior); las demás están en Notas clínicas
  const lastNote =
    (last &&
      notes.find((n) => n.appointment_id === last.id || (!n.appointment_id && localDay(n.created_at) >= localDay(last.scheduled_at)))) ||
    null;

  // Próximo turno: el agendado más cercano desde hoy
  const upcoming = history
    .filter((a) => a.status === "scheduled" && localDay(a.scheduled_at) >= today)
    .sort((x, y) => (x.scheduled_at < y.scheduled_at ? -1 : 1))[0];
  // Sin turno: cuándo le toca volver (el recall más cercano de lo que se hizo)
  const lastByTreatment = new Map<string, { name: string; at: string; days: number }>();
  for (const a of sessions) {
    for (const i of a.items) {
      const t = i.treatment;
      if (!t?.recall_days || lastByTreatment.has(t.name)) continue;
      lastByTreatment.set(t.name, { name: t.name, at: localDay(a.scheduled_at), days: t.recall_days });
    }
  }
  const nextRecall = [...lastByTreatment.values()]
    .map((t) => ({ name: t.name, due: addDays(t.at, t.days) }))
    .sort((x, y) => (x.due < y.due ? -1 : 1))[0];

  const totalSpent = sessions.reduce((s, a) => s + Number(a.amount_paid ?? 0), 0);
  const years = age(p.birth_date);
  const canWrite = !readOnly && !p.marketing_opt_out_at && !!p.phone;

  // ---------------------------------------------------------------------
  // Pestañas
  // ---------------------------------------------------------------------
  const historyTab = (
    <div className="card p-0">
      {sessions.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted">
          Todavía no tiene visitas atendidas. Cuando se registra un turno como atendido aparece acá.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {sessions.map((a) => {
            const groups = groupItems(a.items);
            const n = notesByAppt.get(a.id)?.length ?? 0;
            return (
              <li key={a.id}>
                <Link
                  href={`/turnos/${a.id}`}
                  className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 px-4 py-3 hover:bg-subtle/60"
                >
                  <span className="num text-sm text-muted">{fmtDate(a.scheduled_at)}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{treatmentsLabel(a)}</span>
                    <span className="block truncate text-xs text-muted">
                      {[
                        groups.map((g) => g.detail).filter(Boolean).join(", "),
                        groups.some((g) => g.lot) ? `lote ${[...new Set(groups.map((g) => g.lot).filter(Boolean))].join(", ")}` : "",
                        a.professional?.full_name ?? "",
                        n ? (n === 1 ? "1 nota" : `${n} notas`) : "",
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  </span>
                  {showMoney ? (
                    <span className="num whitespace-nowrap text-sm">{fmtMoney(a.amount_paid, cur)}</span>
                  ) : (
                    <span aria-hidden="true" className="text-muted">›</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  const notesTab = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">Solo la ven las profesionales, el franquiciado y la marca. Recepción no.</p>
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
      <div className="card p-0">
        {notes.length === 0 ? (
          <p className="px-4 py-5 text-sm text-muted">
            Sin notas todavía. Con «+ Nota» se anota lo que pasó en una sesión o algo suelto.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {notes.map((n) => {
              const s = n.appointment_id ? sessions.find((a) => a.id === n.appointment_id) : null;
              return (
                <li key={n.id} className="space-y-1 px-4 py-3">
                  <p className="whitespace-pre-line text-sm">{n.body}</p>
                  <p className="text-xs text-muted">
                    {noteMeta(n)}
                    {s && (
                      <>
                        {" · "}
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
    </div>
  );

  const othersTab = (
    <div className="card p-0">
      {others.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted">No tiene turnos agendados, ausencias ni cancelaciones.</p>
      ) : (
        <ul className="divide-y divide-line">
          {others.map((a) => (
            <li key={a.id}>
              <Link
                href={`/turnos/${a.id}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 px-4 py-3 hover:bg-subtle/60"
              >
                <span className="min-w-0">
                  <span className="num block text-sm">{fmtDateTime(a.scheduled_at)}</span>
                  <span className="block truncate text-xs text-muted">{treatmentsLabel(a)}</span>
                </span>
                <span className={STATUS_CLASS[a.status]}>{STATUS_LABEL[a.status]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const dataTab = (
    <div className="card max-w-2xl space-y-3">
      {readOnly ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {[
            ["Celular", p.phone ? `+${p.phone}` : null],
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
    </div>
  );

  const tabs: TabItem[] = [
    { key: "historial", label: "Historial", count: sessions.length, content: historyTab },
    ...(ctx.canViewClinical ? [{ key: "notas", label: "Notas clínicas", count: notes.length, content: notesTab }] : []),
    { key: "otros", label: "Otros turnos", count: others.length, content: othersTab },
    { key: "datos", label: "Datos", content: dataTab },
  ];

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
              <a
                href={whatsappLink(p.phone!, `Hola ${p.first_name}!`)}
                target="_blank"
                rel="noopener noreferrer"
                className="btn"
              >
                WhatsApp
              </a>
            )}
            <Link href={`/turnos/nuevo?paciente=${p.id}`} className="btn btn-primary">Nuevo turno</Link>
          </div>
        )}
      </div>

      <PatientNotes patientId={p.id} notes={p.notes} canEdit={!readOnly} />

      {/* Lo que hay que hacer ahora */}
      {upcoming ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-ink px-5 py-4 text-surface">
          <div className="min-w-0">
            <p className="text-sm opacity-70">
              {localDay(upcoming.scheduled_at) === today ? "Turno de hoy" : "Próximo turno"}
            </p>
            <p className="text-lg font-semibold">
              {localDay(upcoming.scheduled_at) === today ? "Hoy" : weekdayDay(upcoming.scheduled_at)} a las{" "}
              {fmtTime(upcoming.scheduled_at)}
            </p>
            <p className="truncate text-sm opacity-80">
              {treatmentsLabel(upcoming)}
              {upcoming.professional ? ` con ${upcoming.professional.full_name}` : ""}
              {upcoming.branch && upcoming.branch.name !== ctx.currentBranch.name ? ` en ${upcoming.branch.name}` : ""}
            </p>
          </div>
          {!readOnly &&
            (localDay(upcoming.scheduled_at) <= today ? (
              <Link href={`/turnos/${upcoming.id}?cobrar=1`} className="btn btn-primary">Registrar atención</Link>
            ) : (
              <Link href={`/turnos/${upcoming.id}`} className="btn border-0 bg-surface/10 text-surface hover:bg-surface/20">
                Ver turno
              </Link>
            ))}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line px-5 py-3.5">
          <p className="min-w-0 text-sm">
            {nextRecall ? (
              nextRecall.due <= today ? (
                <>
                  <span className="font-semibold text-warn">Le toca volver</span>{" "}
                  <span className="text-muted">
                    a {nextRecall.name} desde el {shortDay(nextRecall.due)} (hace {daysBetween(nextRecall.due, today)} días)
                  </span>
                </>
              ) : (
                <>
                  <span className="font-semibold">Sin turno agendado.</span>{" "}
                  <span className="text-muted">
                    Le toca volver a {nextRecall.name} el {shortDay(nextRecall.due)}.
                  </span>
                </>
              )
            ) : (
              <span className="text-muted">Sin turno agendado.</span>
            )}
          </p>
          {!readOnly && (
            <Link href={`/turnos/nuevo?paciente=${p.id}`} className="btn btn-sm">Agendar</Link>
          )}
        </div>
      )}

      {/* Salud, última vez y como paciente */}
      <div
        className={`card grid gap-0 divide-y divide-line p-0 lg:divide-x lg:divide-y-0 ${
          ctx.canViewClinical ? "lg:grid-cols-3" : "lg:grid-cols-2"
        }`}
      >
        {ctx.canViewClinical && (
          <section className="space-y-3 p-5">
            <h2 className="text-sm font-semibold text-muted">Salud</h2>
            <ClinicalBackground patientId={p.id} data={(bgData ?? null) as Background | null} />
          </section>
        )}

        <section className="space-y-3 p-5">
          <h2 className="text-sm font-semibold text-muted">Última vez</h2>
          {last ? (
            <>
              <div>
                <p className="font-display text-2xl leading-tight">{ago(daysBetween(localDay(last.scheduled_at), today))}</p>
                <p className="num text-xs text-muted">
                  {fmtDate(last.scheduled_at)}
                  {last.professional ? `, con ${last.professional.full_name}` : ""}
                </p>
              </div>
              <ul className="space-y-1 text-sm">
                {groupItems(last.items).map((g) => (
                  <li key={g.key}>
                    <span className="font-semibold">{g.name}</span>
                    {g.detail && <span className="text-muted"> {g.detail}</span>}
                    {g.lot && <span className="num ml-1.5 text-xs text-muted">lote {g.lot}</span>}
                  </li>
                ))}
              </ul>
              {ctx.canViewClinical && lastNote && (
                <blockquote className="border-l-2 border-line pl-3 text-sm">
                  <p className="line-clamp-3 whitespace-pre-line">{lastNote.body}</p>
                  <footer className="mt-1 text-xs text-muted">{noteMeta(lastNote)}</footer>
                </blockquote>
              )}
              <Link href={`/turnos/${last.id}`} className="text-xs font-semibold text-muted hover:text-ink">
                Ver ese turno
              </Link>
            </>
          ) : (
            <p className="text-sm text-muted">Todavía no se atendió.</p>
          )}
        </section>

        <section className="space-y-3 p-5">
          <h2 className="text-sm font-semibold text-muted">Como paciente</h2>
          <div>
            <p className="font-display text-2xl leading-tight">
              {sessions.length === 0 ? "Sin visitas" : sessions.length === 1 ? "1 visita" : `${sessions.length} visitas`}
            </p>
            {showMoney && sessions.length > 0 && (
              <p className="num text-xs text-muted">
                {fmtMoney(totalSpent, cur)} en total, {fmtMoney(Math.round(totalSpent / sessions.length), cur)} por visita
              </p>
            )}
          </div>
          {p.source && <p className="text-sm text-muted">Nos conoció por {p.source}</p>}
          <div className="flex items-baseline justify-between gap-3 border-t border-line pt-3">
            <p className="text-sm">
              <span className="gold-text num font-display text-xl">{balance?.balance ?? 0}</span>{" "}
              <span className="text-muted">Beauty Millas</span>
            </p>
            {moves?.[0] && (
              <p className="num text-xs text-muted">
                {moves[0].points > 0 ? `+${moves[0].points}` : moves[0].points} el {fmtDate(moves[0].created_at)}
              </p>
            )}
          </div>
          {!readOnly && (
            <details className="fold">
              <summary className="cursor-pointer text-xs font-semibold text-muted hover:text-ink">
                Canjear o sumar millas
              </summary>
              <div className="pt-3">
                <PointsForm patientId={p.id} />
                {moves && moves.length > 0 && (
                  <ul className="mt-3 space-y-1 text-xs text-muted">
                    {moves.slice(0, 5).map((m) => (
                      <li key={m.id} className="flex justify-between gap-2">
                        <span className="truncate">
                          {fmtDate(m.created_at)} {m.reason}
                        </span>
                        <span className="num">{m.points > 0 ? `+${m.points}` : m.points}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
          )}
          {ctx.showRoadmap && <SoonButton label="Mandarle su saldo por WhatsApp" />}
        </section>
      </div>

      <Tabs items={tabs} label="Ficha de la paciente" />
    </div>
  );
}

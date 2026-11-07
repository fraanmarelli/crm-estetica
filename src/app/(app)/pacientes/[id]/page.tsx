import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireBranchContext } from "@/lib/context";
import { fmtDate, fmtDateTime, fmtMoney, fullName, STATUS_CLASS, STATUS_LABEL } from "@/lib/format";
import type { AppointmentStatus, Patient } from "@/lib/types";
import { ClinicalBackground, type Background } from "./clinical-background";
import { NoteComposer } from "./note-composer";
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
    treatment: { name: string; unit_label: string | null } | null;
  }[];
};

type Note = { id: string; appointment_id: string | null; body: string; author_name: string | null; created_at: string };

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function dayParts(iso: string) {
  const [y, m, d] = new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).split("-");
  return { day: Number(d), month: MONTHS[Number(m) - 1], year: y };
}
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
const noteMeta = (n: Note) =>
  `${n.author_name ?? "Equipo"} · ${fmtDate(n.created_at)} ${new Date(n.created_at).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "America/Argentina/Buenos_Aires",
  })}`;
const qty = (n: number | null, unit: string | null) =>
  n === null ? null : `${String(n).replace(".", ",")}${unit ? ` ${unit}` : ""}`;

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
        "id, scheduled_at, status, amount_paid, payment_method, notes, branch:branches(name), professional:professionals(full_name), items:appointment_items(zone, quantity, lot_code, treatment:treatments(name, unit_label))",
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
          .order("created_at", { ascending: true })
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

  const notes = (notesData ?? []) as Note[];
  const notesByAppt = new Map<string, Note[]>();
  for (const n of notes) {
    if (!n.appointment_id) continue;
    notesByAppt.set(n.appointment_id, [...(notesByAppt.get(n.appointment_id) ?? []), n]);
  }
  const looseNotes = notes.filter((n) => !n.appointment_id);
  const readOnly = ctx.isProfessionalOnly;

  const history = (appts ?? []) as unknown as Appt[];
  const p = patient as Patient & { home_branch: { name: string } | null };
  // Historia clínica: sesiones atendidas (la más reciente arriba) y un resumen por tratamiento
  const sessions = history.filter((a) => a.status === "completed");
  const others = history.filter((a) => a.status !== "completed");
  const byTreatment = new Map<string, { name: string; count: number; last: string }>();
  for (const a of sessions) {
    for (const name of new Set(a.items.map((i) => i.treatment?.name).filter(Boolean) as string[])) {
      const t = byTreatment.get(name) ?? { name, count: 0, last: a.scheduled_at };
      t.count++;
      if (a.scheduled_at > t.last) t.last = a.scheduled_at;
      byTreatment.set(name, t);
    }
  }
  const summary = [...byTreatment.values()].sort((x, y) => y.count - x.count);
  // Línea de tiempo: sesiones atendidas y notas sueltas, la más reciente arriba
  type Entry = { kind: "session"; at: string; session: Appt } | { kind: "note"; at: string; note: Note };
  const timeline: Entry[] = [
    ...sessions.map((a) => ({ kind: "session" as const, at: a.scheduled_at, session: a })),
    ...looseNotes.map((n) => ({ kind: "note" as const, at: n.created_at, note: n })),
  ].sort((x, y) => (x.at < y.at ? 1 : -1));
  const totalSpent = history
    .filter((a) => a.status === "completed")
    .reduce((s, a) => s + Number(a.amount_paid ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="page-head">
        <div>
          <h1>{fullName(p)}</h1>
          <p className="page-sub">
            {p.phone ?? "Sin teléfono"} · Sucursal de origen: {p.home_branch?.name ?? "—"} · Alta {fmtDate(p.created_at)}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {!p.consent_data_at &&
              (readOnly ? (
                <span className="badge badge-amber">Ficha incompleta</span>
              ) : (
                <Link href={`/pacientes/${p.id}/completar`} className="badge badge-amber hover:underline">
                  Ficha incompleta · completar
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
          <Link href={`/turnos/nuevo?paciente=${p.id}`} className="btn btn-primary">Nuevo turno</Link>
        )}
      </div>

      <PatientNotes patientId={p.id} notes={p.notes} canEdit={!readOnly} />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {ctx.canViewClinical ? (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <h2>
                Historia clínica <span className="num font-normal text-muted">{sessions.length}</span>
              </h2>
              <span className="ml-auto hidden text-xs text-muted sm:inline">No la ve recepción</span>
              <NoteComposer
                patientId={p.id}
                sessions={sessions.map((a) => ({
                  id: a.id,
                  label: `${a.items.map((i) => i.treatment?.name).filter(Boolean).join(" + ") || "Sesión"} · ${fmtDate(a.scheduled_at)}`,
                }))}
              />
            </div>

            <ClinicalBackground patientId={p.id} data={(bgData ?? null) as Background | null} />

            {summary.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {summary.map((t) => (
                  <li key={t.name} className="rounded-full bg-subtle px-3 py-1 text-xs">
                    <span className="font-semibold">{t.name}</span>{" "}
                    <span className="text-muted">
                      ×{t.count} · última {fmtDate(t.last)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {sessions.length === 0 && looseNotes.length === 0 ? (
              <div className="card space-y-2 text-sm text-muted">
                <p>
                  Todavía no tiene sesiones atendidas. Cuando se registra un turno como atendido aparece acá con lo
                  que se hizo; las notas se agregan desde acá.
                </p>
              </div>
            ) : (
              <ol className="card divide-y divide-line p-0">
                {timeline.map((entry) => {
                  const d = dayParts(entry.at);
                  if (entry.kind === "note") {
                    const n = entry.note;
                    return (
                      <li key={n.id} className="grid grid-cols-[3.5rem_1fr] gap-x-4 px-4 py-3.5">
                        <div className="text-center leading-none">
                          <span className="num block text-lg font-semibold text-muted">{d.day}</span>
                          <span className="block text-xs uppercase tracking-wide text-muted">{d.month}</span>
                        </div>
                        <div className="min-w-0 space-y-1">
                          <p className="text-xs text-muted">Nota · {noteMeta(n)}</p>
                          <p className="whitespace-pre-line text-sm">{n.body}</p>
                        </div>
                      </li>
                    );
                  }
                  const a = entry.session;
                  const sessionNotes = notesByAppt.get(a.id) ?? [];
                  return (
                    <li key={a.id} className="grid grid-cols-[3.5rem_1fr] gap-x-4 px-4 py-4 sm:grid-cols-[3.5rem_1fr_auto]">
                      <div className="text-center leading-none">
                        <span className="num block text-2xl font-semibold">{d.day}</span>
                        <span className="block text-xs uppercase tracking-wide text-muted">{d.month}</span>
                        <span className="num mt-0.5 block text-[0.7rem] text-muted">{d.year}</span>
                      </div>
                      <div className="min-w-0 space-y-2">
                        <p className="text-xs text-muted">
                          {[a.professional?.full_name, a.branch?.name].filter(Boolean).join(" · ") || "—"}
                        </p>
                        <ul className="space-y-1">
                          {a.items.length === 0 && <li className="text-sm text-muted">Sin tratamiento cargado</li>}
                          {groupItems(a.items).map((g) => (
                            <li key={g.key} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                              <span className="font-semibold">{g.name}</span>
                              {g.detail && <span className="text-muted">{g.detail}</span>}
                              {g.lot && <span className="badge badge-gray num">Lote {g.lot}</span>}
                            </li>
                          ))}
                        </ul>
                        {sessionNotes.length > 0 && (
                          <ul className="space-y-2 border-l-2 border-brand/40 pl-3">
                            {sessionNotes.map((n) => (
                              <li key={n.id}>
                                <p className="whitespace-pre-line text-sm">{n.body}</p>
                                <p className="text-xs text-muted">{noteMeta(n)}</p>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      {!readOnly && (
                        <div className="col-start-2 mt-2 flex items-center gap-3 sm:col-start-3 sm:mt-0 sm:flex-col sm:items-end sm:gap-1">
                          {ctx.canManageCurrentBranch && (
                            <span className="num whitespace-nowrap text-sm">{fmtMoney(a.amount_paid, ctx.org.currency)}</span>
                          )}
                          <Link href={`/turnos/${a.id}`} className="text-xs text-muted hover:text-ink hover:underline">
                            Ver turno
                          </Link>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}

            {others.length > 0 && (
              <details className="card fold p-0">
                <summary className="fold-summary px-4 py-3 text-sm">
                  <span className="font-semibold">
                    Otros turnos <span className="num font-normal text-muted">{others.length}</span>
                  </span>
                  <span className="text-xs text-muted">agendados, no vino, cancelados</span>
                </summary>
                <ul className="divide-y divide-line border-t border-line">
                  {others.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                      <span className="whitespace-nowrap">{fmtDateTime(a.scheduled_at)}</span>
                      <span className="min-w-0 flex-1 truncate text-muted">
                        {a.items.map((i) => i.treatment?.name).filter(Boolean).join(", ") || "—"}
                      </span>
                      <span className={STATUS_CLASS[a.status]}>{STATUS_LABEL[a.status]}</span>
                      <Link href={`/turnos/${a.id}`} className="btn btn-sm">Abrir</Link>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        ) : (
        <section className="space-y-3">
          <h2>Historial ({history.length}) · {fmtMoney(totalSpent, ctx.org.currency)}</h2>
          <div className="card overflow-x-auto p-0">
            {history.length === 0 ? (
              <p className="p-4 text-sm text-muted">Sin turnos todavía.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Tratamiento</th>
                    <th>Sucursal</th>
                    <th>Monto</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((a) => (
                    <tr key={a.id}>
                      <td className="whitespace-nowrap">{fmtDateTime(a.scheduled_at)}</td>
                      <td>
                        {a.items
                          .map((i) => [i.treatment?.name, i.zone].filter(Boolean).join(" - "))
                          .join(", ") || "—"}
                        {a.professional && (
                          <span className="block text-xs text-muted">{a.professional.full_name}</span>
                        )}
                      </td>
                      <td className="text-muted">{a.branch?.name ?? "—"}</td>
                      <td>
                        <span className="whitespace-nowrap">{fmtMoney(a.amount_paid, ctx.org.currency)}</span>
                        {a.payment_method && <span className="block text-xs text-muted">{a.payment_method}</span>}
                      </td>
                      <td>
                        <span className={STATUS_CLASS[a.status]}>{STATUS_LABEL[a.status]}</span>
                      </td>
                      <td>
                        <Link href={`/turnos/${a.id}`} className="btn btn-sm">Abrir</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
        )}

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
                  ["Celular", p.phone ? `+${p.phone}` : null],
                  ["DNI", p.dni],
                  ["Email", p.email],
                  ["Nacimiento", p.birth_date ? fmtDate(`${p.birth_date}T12:00:00-03:00`) : null],
                ].map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted">{k}</dt>
                    <dd className="min-w-0 break-words">{v || "—"}</dd>
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

import Link from "next/link";
import { SectionTabs } from "@/components/section-tabs";
import { SubmitButton } from "@/components/submit-button";
import { requireManagerContext } from "@/lib/context";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { markChangeReviewed } from "./actions";

type Snapshot = { total?: number; cuentas?: Record<string, number> };
type Alert = {
  id: string;
  kind: "payment_edited" | "completed_reverted" | "loyalty_manual";
  appointment_id: string | null;
  patient_id: string | null;
  actor_email: string | null;
  before: (Snapshot & { estado?: string; cobrado?: number }) | null;
  after: (Snapshot & { estado?: string; cobrado?: number; millas?: number }) | null;
  detail: string | null;
  created_at: string;
  reviewed_at: string | null;
  patient: { first_name: string; last_name: string | null } | null;
  appointment: { scheduled_at: string } | null;
};

const STATUS: Record<string, string> = {
  scheduled: "agendado",
  completed: "atendido",
  no_show: "no vino",
  cancelled: "cancelado",
};

// Un cobro editado que quedó igual (se guardó sin cambiar nada) no se muestra
const sameSnapshot = (a: Snapshot | null, b: Snapshot | null) =>
  JSON.stringify({ t: Number(a?.total ?? 0), c: a?.cuentas ?? {} }) ===
  JSON.stringify({ t: Number(b?.total ?? 0), c: b?.cuentas ?? {} });

// Cambios hechos por recepción (o cualquiera que no sea franquiciado ni marca) que conviene mirar:
// cobros editados de turnos ya atendidos, turnos atendidos que dejaron de estarlo y millas a mano.
export default async function ChangesPage() {
  const ctx = await requireManagerContext();
  const supabase = await createClient();
  const cur = ctx.org.currency;

  const { data } = await supabase
    .from("change_alerts")
    .select(
      "id, kind, appointment_id, patient_id, actor_email, before, after, detail, created_at, reviewed_at, patient:patients(first_name, last_name), appointment:appointments(scheduled_at)",
    )
    .eq("branch_id", ctx.currentBranch.id)
    .order("created_at", { ascending: false })
    .limit(200);
  const alerts = ((data ?? []) as unknown as Alert[]).filter(
    (a) => a.kind !== "payment_edited" || !sameSnapshot(a.before, a.after),
  );
  const pending = alerts.filter((a) => !a.reviewed_at);
  const reviewed = alerts.filter((a) => a.reviewed_at);

  const accounts = (s: Snapshot | null) =>
    Object.entries(s?.cuentas ?? {})
      .map(([k, v]) => `${k} ${fmtMoney(v, cur)}`)
      .join(" + ") || "sin cobro";

  const row = (a: Alert) => {
    const who = a.actor_email?.split("@")[0] ?? "alguien del equipo";
    const patient = a.patient ? `${a.patient.first_name} ${a.patient.last_name ?? ""}`.trim() : "una paciente";
    let what: React.ReactNode;
    if (a.kind === "payment_edited") {
      what = (
        <>
          <p>
            <b>{who}</b> cambió el cobro de <b>{patient}</b>
            {a.appointment ? ` (turno del ${fmtDate(a.appointment.scheduled_at)})` : ""}
          </p>
          <p className="num text-sm">
            <span className="text-muted line-through decoration-muted/60">{accounts(a.before)}</span>
            <span className="mx-2 text-muted">→</span>
            <span className="font-semibold">{accounts(a.after)}</span>
          </p>
        </>
      );
    } else if (a.kind === "completed_reverted") {
      what = (
        <>
          <p>
            <b>{who}</b> pasó el turno de <b>{patient}</b> de atendido a {STATUS[a.after?.estado ?? ""] ?? a.after?.estado}
          </p>
          <p className="num text-sm text-muted">Tenía cobrado {fmtMoney(a.before?.cobrado ?? 0, cur)}: deja de contar.</p>
        </>
      );
    } else {
      const pts = Number(a.after?.millas ?? 0);
      what = (
        <>
          <p>
            <b>{who}</b> {pts > 0 ? `sumó ${pts}` : `canjeó ${-pts}`} Beauty Millas a mano a <b>{patient}</b>
          </p>
          {a.detail && <p className="text-sm text-muted">Motivo: {a.detail}</p>}
        </>
      );
    }
    return (
      <li key={a.id} className="grid gap-3 px-4 py-3.5 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="min-w-0 space-y-1 text-sm">
          {what}
          <p className="text-xs text-muted">{fmtDateTime(a.created_at)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {a.appointment_id ? (
            <Link href={`/turnos/${a.appointment_id}`} className="btn btn-sm">
              Ver turno
            </Link>
          ) : (
            a.patient_id && (
              <Link href={`/pacientes/${a.patient_id}`} className="btn btn-sm">
                Ver paciente
              </Link>
            )
          )}
          {!a.reviewed_at && (
            <form action={markChangeReviewed}>
              <input type="hidden" name="id" value={a.id} />
              <SubmitButton className="btn btn-sm btn-primary" pendingText="Marcando...">
                Revisado
              </SubmitButton>
            </form>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <SectionTabs section="numeros" />
      <div className="page-head">
        <div>
          <h1>Cambios</h1>
          <p className="page-sub">
            Lo que cambió recepción después de cobrar: cobros editados, turnos atendidos que dejaron de estarlo y
            millas cargadas a mano. Lo que hacés vos no aparece acá.
          </p>
        </div>
        {pending.length > 1 && (
          <form action={markChangeReviewed}>
            <input type="hidden" name="id" value="all" />
            <SubmitButton className="btn btn-sm" pendingText="Marcando...">
              Marcar todos como revisados
            </SubmitButton>
          </form>
        )}
      </div>

      <section className="space-y-2">
        <h2>
          Para revisar <span className="num font-normal text-muted">{pending.length}</span>
        </h2>
        {pending.length === 0 ? (
          <div className="card text-sm text-muted">Nada para revisar. Si recepción cambia un cobro ya hecho, aparece acá.</div>
        ) : (
          <ul className="card divide-y divide-line p-0">{pending.map(row)}</ul>
        )}
      </section>

      {reviewed.length > 0 && (
        <details className="card fold p-0">
          <summary className="fold-summary px-4 py-3">
            <span className="font-semibold">
              Revisados <span className="num font-normal text-muted">{reviewed.length}</span>
            </span>
          </summary>
          <ul className="divide-y divide-line border-t border-line">{reviewed.map(row)}</ul>
        </details>
      )}
    </div>
  );
}

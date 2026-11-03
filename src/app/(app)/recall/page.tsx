import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireBranchContext } from "@/lib/context";
import {
  DEFAULT_RECALL_MESSAGE,
  daysUntil,
  fillTemplate,
  fmtDate,
  fullName,
  monthsSince,
  OUTCOME_LABEL,
  todayISO,
  whatsappLink,
} from "@/lib/format";
import { SubmitButton } from "@/components/submit-button";
import { IconWhatsApp } from "@/components/icons";
import { logRecall } from "../actions";
import type { RecallOutcome } from "@/lib/types";

type Row = {
  patient_id: string;
  treatment_id: string;
  treatment_name: string;
  last_done_at: string;
  due_date: string;
  first_name: string;
  last_name: string | null;
  phone: string;
  consent_marketing_at: string | null;
  last_contacted_at: string | null;
  last_outcome: RecallOutcome | null;
};

const WINDOWS = [
  { key: "vencidos", label: "Vencidos", days: 0 },
  { key: "semana", label: "Próximos 7 días", days: 7 },
  { key: "mes", label: "Próximos 30 días", days: 30 },
];

export default async function RecallPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const ctx = await requireBranchContext();
  const { ver = "vencidos" } = await searchParams;
  const window = WINDOWS.find((w) => w.key === ver) ?? WINDOWS[0];

  const limit = new Date(`${todayISO()}T12:00:00-03:00`);
  limit.setDate(limit.getDate() + window.days);
  const limitISO = limit.toISOString().slice(0, 10);

  const supabase = await createClient();
  const { data } = await supabase
    .from("recall_queue")
    .select(
      "patient_id, treatment_id, treatment_name, last_done_at, due_date, first_name, last_name, phone, consent_marketing_at, last_contacted_at, last_outcome",
    )
    .eq("branch_id", ctx.currentBranch.id)
    .lte("due_date", limitISO)
    .or("last_outcome.is.null,last_outcome.not.in.(not_interested,wrong_number,opted_out)")
    .order("due_date", { ascending: true })
    .limit(200);

  const rows = (data ?? []) as Row[];
  const template = ctx.org.settings.recall_message || DEFAULT_RECALL_MESSAGE;
  const branchLabel = `${ctx.org.name} ${ctx.currentBranch.name}`;

  return (
    <div className="space-y-4">
      <div className="page-head">
        <div>
          <h1>Recall</h1>
          <p className="page-sub">
            Pacientes de {ctx.currentBranch.name} a las que les toca repetir un tratamiento. Escribiles y registrá qué
            respondieron.
          </p>
        </div>
      </div>

      <div className="flex gap-1">
        {WINDOWS.map((w) => (
          <Link
            key={w.key}
            href={`/recall?ver=${w.key}`}
            className={`btn btn-sm ${w.key === window.key ? "btn-primary" : ""}`}
          >
            {w.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="card text-sm text-muted">No hay pacientes para recontactar en este período.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const days = daysUntil(r.due_date);
            const message = fillTemplate(template, {
              nombre: r.first_name,
              sucursal: branchLabel,
              meses: monthsSince(r.last_done_at),
              tratamiento: r.treatment_name,
            });
            return (
              <div
                key={`${r.patient_id}-${r.treatment_id}`}
                className="card grid gap-3 md:grid-cols-[1.4fr_1fr_auto] md:items-center"
              >
                <div>
                  <Link href={`/pacientes/${r.patient_id}`} className="link">
                    {fullName(r)}
                  </Link>
                  <p className="text-sm text-muted">
                    {r.treatment_name} · último {fmtDate(r.last_done_at)}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className={`badge ${days < 0 ? "badge-red" : days === 0 ? "badge-amber" : "badge-blue"}`}>
                      {days < 0 ? `Vencido hace ${-days} días` : days === 0 ? "Vence hoy" : `Vence en ${days} días`}
                    </span>
                    {!r.consent_marketing_at && <span className="badge badge-amber">Sin consentimiento</span>}
                    {r.last_outcome && (
                      <span className="badge badge-gray">
                        {OUTCOME_LABEL[r.last_outcome]} · {fmtDate(r.last_contacted_at)}
                      </span>
                    )}
                  </div>
                </div>

                <a
                  href={whatsappLink(r.phone, message)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary"
                >
                  <IconWhatsApp className="h-4 w-4" />
                  Escribir por WhatsApp
                </a>

                <form action={logRecall} className="flex gap-2">
                  <input type="hidden" name="patient_id" value={r.patient_id} />
                  <input type="hidden" name="treatment_id" value={r.treatment_id} />
                  <select name="outcome" className="input" defaultValue="no_answer" aria-label="Resultado">
                    {(Object.keys(OUTCOME_LABEL) as RecallOutcome[]).map((o) => (
                      <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>
                    ))}
                  </select>
                  <SubmitButton className="btn" pendingText="...">Registrar</SubmitButton>
                </form>
              </div>
            );
          })}
        </div>
      )}
      {rows.length === 200 && (
        <p className="text-xs text-muted">Se muestran las primeras 200, empezando por las más vencidas.</p>
      )}
    </div>
  );
}

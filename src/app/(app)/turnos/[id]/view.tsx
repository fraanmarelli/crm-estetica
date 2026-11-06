import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireBranchContext } from "@/lib/context";
import { loadCatalog } from "@/lib/catalog";
import { STATUS_LABEL, fmtDateTime, fullName, isoToLocalInput } from "@/lib/format";
import { AppointmentForm } from "@/components/appointment-form";
import { AutoRefresh } from "@/components/auto-refresh";
import { IntakePrompt } from "@/components/intake-prompt";
import { TransferStatus, loadTransferChecks, type TransferCheck } from "@/components/transfer-status";
import type { AppointmentStatus } from "@/lib/types";

type Appt = {
  id: string;
  branch_id: string;
  patient_id: string;
  professional_id: string | null;
  scheduled_at: string;
  duration_minutes: number;
  status: AppointmentStatus;
  notes: string | null;
  patient: { first_name: string; last_name: string | null; consent_data_at: string | null; notes: string | null } | null;
  branch: { name: string } | null;
  items: {
    treatment_id: string;
    zone: string | null;
    quantity: number | null;
    price: number | null;
    promotion_id: string | null;
    promotion: { name: string } | null;
    lot_code: string | null;
  }[];
  payments: { account_id: string; amount: number; exchange_rate: number | null; is_deposit: boolean }[];
  checks: TransferCheck[];
};

// El turno: pantalla completa (/turnos/[id]) o ventana encima de la agenda en la compu (@modal)
export async function AppointmentView({ id, sp }: { id: string; sp: { cobrar?: string; vista?: string } }) {
  const ctx = await requireBranchContext();
  const supabase = await createClient();

  const { data } = await supabase
    .from("appointments")
    .select(
      `id, branch_id, patient_id, professional_id, scheduled_at, duration_minutes, status, notes, patient:patients(first_name, last_name, consent_data_at, notes), branch:branches(name), items:appointment_items(treatment_id, zone, quantity, price, promotion_id, lot_code, promotion:promotions(name)), payments:appointment_payments(account_id, amount, exchange_rate, is_deposit)`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();
  const appt = data as unknown as Appt;
  appt.checks = (await loadTransferChecks(supabase, [appt.id])).get(appt.id) ?? [];

  if (appt.branch_id !== ctx.currentBranch.id) {
    return (
      <div className="card mx-auto max-w-md space-y-3">
        <h1>Turno de otra sucursal</h1>
        <p className="text-sm text-muted">
          Este turno es de {appt.branch?.name}. Cambiá de sucursal arriba para editarlo.
        </p>
        <Link href={`/pacientes/${appt.patient_id}`} className="btn">Volver a la paciente</Link>
      </div>
    );
  }

  const name = appt.patient ? fullName(appt.patient) : "Paciente";

  // Profesional: resumen de solo lectura (no cobra ni edita turnos)
  if (ctx.isProfessionalOnly) {
    const { data: pro } = appt.professional_id
      ? await supabase.from("professionals").select("full_name").eq("id", appt.professional_id).maybeSingle()
      : { data: null };
    const { data: tr } = await supabase
      .from("treatments")
      .select("id, name, unit_label")
      .in("id", appt.items.map((i) => i.treatment_id).length ? appt.items.map((i) => i.treatment_id) : ["00000000-0000-0000-0000-000000000000"]);
    const tName = new Map(((tr ?? []) as { id: string; name: string; unit_label: string | null }[]).map((t) => [t.id, t]));
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <div>
          <h1>Turno · {name}</h1>
          <p className="page-sub">
            {fmtDateTime(appt.scheduled_at)} · {pro?.full_name ?? "Sin profesional"} · {STATUS_LABEL[appt.status]}
          </p>
        </div>
        <section className="card space-y-2">
          <h2 className="text-base">Tratamientos</h2>
          {appt.items.length === 0 ? (
            <p className="text-sm text-muted">Sin tratamiento cargado.</p>
          ) : (
            <ul className="space-y-1.5">
              {appt.items.map((i, k) => {
                const t = tName.get(i.treatment_id);
                return (
                  <li key={k} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-semibold">{i.promotion?.name ?? t?.name ?? "Tratamiento"}</span>
                    <span className="text-muted">
                      {[i.zone, i.quantity !== null ? `${String(i.quantity).replace(".", ",")} ${t?.unit_label ?? ""}`.trim() : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {i.lot_code && <span className="badge badge-gray num">Lote {i.lot_code}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <Link href={`/pacientes/${appt.patient_id}`} className="btn btn-primary">
          Ver ficha e historia clínica
        </Link>
      </div>
    );
  }

  const { treatments, professionals, accounts, promotions, lastLots } = await loadCatalog(ctx.org.id, ctx.currentBranch.id);
  let commission = "";
  if (ctx.canManageCurrentBranch) {
    const { data: c } = await supabase.rpc("appointment_commission", { p_appointment: appt.id });
    if (c?.[0]?.commission_manual && c[0].commission !== null) commission = String(c[0].commission);
  }
  const s = (v: number | string | null) => (v === null ? "" : String(v));
  const checkout = sp.cobrar === "1" && appt.status !== "cancelled";

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1>{checkout ? `Cobrar a ${name}` : `Turno · ${name}`}</h1>
        <p className="page-sub">
          {checkout
            ? "Confirmá qué se hizo, la cantidad de insumo, el precio y cómo pagó."
            : "Para reprogramarlo, cambiá la fecha. Para registrar que se atendió, usá «Cobrar» desde la agenda."}
        </p>
      </div>
      {checkout && appt.patient && !appt.patient.consent_data_at && (
        <IntakePrompt
          patientId={appt.patient_id}
          firstName={appt.patient.first_name}
          volver={`/turnos/${appt.id}?cobrar=1${sp.vista === "semana" ? "&vista=semana" : ""}`}
        />
      )}
      {appt.patient?.notes && (
        <p className="rounded-xl border border-warn-line bg-warn-soft px-3.5 py-2.5 text-sm">
          <span className="font-semibold text-warn">Para tener en cuenta: </span>
          {appt.patient.notes}
        </p>
      )}
      {appt.patient && !appt.patient.consent_data_at && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warn-line bg-warn-soft px-4 py-3 text-sm text-warn">
          <span>
            <b>Ficha incompleta:</b> faltan sus datos y el consentimiento.
          </span>
          <Link
            href={`/pacientes/${appt.patient_id}/completar?volver=${encodeURIComponent(`/turnos/${appt.id}${checkout ? "?cobrar=1" : ""}`)}`}
            className="btn btn-sm"
          >
            Completar ficha
          </Link>
        </div>
      )}
      {appt.checks?.length > 0 && (
        <div className="card space-y-2">
          <h2 className="text-base">Transferencias en Mercado Pago</h2>
          <TransferStatus checks={appt.checks} />
          {appt.checks.some((c) => c.status === "pending") && <AutoRefresh />}
        </div>
      )}
      <AppointmentForm
        patientId={appt.patient_id}
        treatments={treatments}
        professionals={professionals}
        accounts={accounts}
        promotions={promotions}
        lastLots={lastLots}
        canSeeCosts={ctx.canManageCurrentBranch}
        mode={checkout ? "checkout" : "full"}
        returnView={sp.vista === "semana" ? "semana" : undefined}
        defaults={{
          id: appt.id,
          scheduled_at: isoToLocalInput(appt.scheduled_at),
          duration_minutes: String(appt.duration_minutes ?? 30),
          status: checkout ? "completed" : appt.status,
          professional_id: appt.professional_id ?? "",
          notes: appt.notes ?? "",
          items: appt.items.map((i) => ({
            treatment_id: i.treatment_id,
            zone: i.zone ?? "",
            quantity: s(i.quantity),
            price: s(i.price),
            promotion_id: i.promotion_id ?? "",
            promotion_name: i.promotion?.name ?? "",
            lot_code: i.lot_code ?? "",
          })),
          payments: appt.payments.map((p) => ({
            account_id: p.account_id,
            amount: s(p.amount),
            exchange_rate: s(p.exchange_rate),
            is_deposit: p.is_deposit,
          })),
          commission,
        }}
      />
    </div>
  );
}

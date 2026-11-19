import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { SubmitButton } from "@/components/submit-button";
import { createClient } from "@/lib/supabase/server";
import { requireContactContext } from "@/lib/context";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { CBTE_NOTA_CREDITO_C, invoiceLabel, ivaLabel } from "@/lib/arca/core";
import { recheckInvoice } from "../actions";
import { CancelInvoiceForm, SharePdfButton } from "./invoice-actions";

type Inv = {
  id: string;
  branch_id: string;
  appointment_id: string | null;
  patient_id: string | null;
  environment: string;
  cbte_tipo: number;
  point_of_sale: number;
  number: number | null;
  status: "pending" | "issued" | "failed";
  issue_date: string;
  concept: number;
  doc_type: number;
  doc_number: string | null;
  iva_condition: number;
  receiver_name: string | null;
  total: number;
  lines: { description: string; quantity: number; unit_price: number }[];
  issuer: { business_name: string; cuit: string };
  cae: string | null;
  cae_due: string | null;
  cancels_invoice_id: string | null;
  error: string | null;
  created_by_name: string | null;
  created_at: string;
};

const DOC: Record<number, string> = { 80: "CUIT", 86: "CUIL", 96: "DNI" };

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ emitida?: string }>;
}) {
  const ctx = await requireContactContext();
  const { id } = await params;
  const { emitida } = await searchParams;
  const supabase = await createClient();
  const [{ data }, { data: creditData }] = await Promise.all([
    supabase
      .from("invoices")
      .select(
        "id, branch_id, appointment_id, patient_id, environment, cbte_tipo, point_of_sale, number, status, issue_date, concept, doc_type, doc_number, iva_condition, receiver_name, total, lines, issuer, cae, cae_due, cancels_invoice_id, error, created_by_name, created_at",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("invoices")
      .select("id, cbte_tipo, point_of_sale, number, issue_date")
      .eq("cancels_invoice_id", id)
      .eq("status", "issued")
      .maybeSingle(),
  ]);
  const inv = data as Inv | null;
  if (!inv || inv.branch_id !== ctx.currentBranch.id) notFound();
  const credit = creditData as { id: string; cbte_tipo: number; point_of_sale: number; number: number; issue_date: string } | null;

  const label = inv.number ? invoiceLabel(inv.cbte_tipo, inv.point_of_sale, Number(inv.number)) : "Factura C";
  const isNc = inv.cbte_tipo === CBTE_NOTA_CREDITO_C;
  const client =
    inv.doc_type === 99
      ? inv.receiver_name || "Consumidor final"
      : `${inv.receiver_name ? `${inv.receiver_name} · ` : ""}${DOC[inv.doc_type] ?? "Doc."} ${inv.doc_number ?? ""}`;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <BackLink fallback={inv.appointment_id ? `/turnos/${inv.appointment_id}` : ctx.canManageCurrentBranch ? "/facturacion" : "/"} />

      {emitida && inv.status === "issued" && (
        <p className="alert-ok">
          {isNc ? "Nota de crédito emitida" : "Factura emitida"} en ARCA. CAE {inv.cae}.
        </p>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>{label}</h1>
          <p className="page-sub">
            {inv.issuer.business_name} · {fmtDate(inv.issue_date)}
            {inv.environment === "test" && <span className="badge badge-amber ml-2">Prueba · sin validez fiscal</span>}
          </p>
        </div>
        <p className="num text-2xl font-semibold">{isNc ? `−${fmtMoney(inv.total)}` : fmtMoney(inv.total)}</p>
      </div>

      {inv.status === "pending" && (
        <div className="card space-y-3 border-warn-line bg-warn-soft">
          <p className="text-sm">
            <b className="text-warn">Por confirmar.</b> Se cortó la conexión con ARCA mientras se emitía y no sabemos si salió.
            Revisá en unos minutos: si ARCA la tiene, queda emitida; si no, podés emitirla de nuevo.
          </p>
          <form action={recheckInvoice}>
            <input type="hidden" name="invoice_id" value={inv.id} />
            <SubmitButton pendingText="Consultando a ARCA...">Revisar en ARCA</SubmitButton>
          </form>
        </div>
      )}
      {inv.status === "failed" && (
        <p className="alert-error">No se emitió: {inv.error ?? "ARCA la rechazó."}</p>
      )}
      {credit && (
        <p className="rounded-xl border border-line bg-subtle px-4 py-3 text-sm">
          Anulada con la{" "}
          <Link href={`/facturas/${credit.id}`} className="link">
            {invoiceLabel(credit.cbte_tipo, credit.point_of_sale, Number(credit.number))}
          </Link>{" "}
          del {fmtDate(credit.issue_date)}.
        </p>
      )}

      <section className="card space-y-3">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">Cliente</dt>
            <dd>{client}</dd>
          </div>
          <div>
            <dt className="text-muted">Condición frente al IVA</dt>
            <dd>{ivaLabel(inv.iva_condition)}</dd>
          </div>
          <div>
            <dt className="text-muted">Concepto</dt>
            <dd>{inv.concept === 1 ? "Productos" : "Servicios"}</dd>
          </div>
          {inv.cae && (
            <div>
              <dt className="text-muted">CAE</dt>
              <dd className="num">
                {inv.cae} · vence {fmtDate(inv.cae_due)}
              </dd>
            </div>
          )}
        </dl>
        <table className="table">
          <thead>
            <tr>
              <th>Descripción</th>
              <th className="text-right">Cant.</th>
              <th className="text-right">Precio</th>
              <th className="text-right">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l, i) => (
              <tr key={i}>
                <td>{l.description}</td>
                <td className="num text-right">{String(l.quantity).replace(".", ",")}</td>
                <td className="num text-right">{fmtMoney(l.unit_price)}</td>
                <td className="num text-right">{fmtMoney(l.quantity * l.unit_price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-muted">
          La emitió {inv.created_by_name ?? "el equipo"} el {fmtDateTime(inv.created_at)}.
          {inv.appointment_id && (
            <>
              {" "}
              <Link href={`/turnos/${inv.appointment_id}`} className="link">Ver turno</Link>
            </>
          )}
        </p>
      </section>

      {inv.status === "issued" && (
        <div className="flex flex-wrap gap-2">
          <a href={`/facturas/${inv.id}/pdf`} target="_blank" rel="noopener" className="btn btn-primary">
            Ver PDF
          </a>
          <SharePdfButton url={`/facturas/${inv.id}/pdf`} fileName={`${label.replace(/\s+/g, "-")}.pdf`} />
        </div>
      )}

      {inv.status === "issued" && !isNc && !credit && ctx.canManageCurrentBranch && (
        <CancelInvoiceForm invoiceId={inv.id} label={label} total={fmtMoney(inv.total)} />
      )}
    </div>
  );
}

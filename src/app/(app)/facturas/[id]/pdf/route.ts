import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { invoiceLabel } from "@/lib/arca/core";
import { invoicePdf } from "@/lib/arca/pdf";

// PDF de una factura emitida. La lee con la sesión del usuario: si no puede verla (RLS), no hay PDF.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: inv } = await supabase
    .from("invoices")
    .select(
      "environment, cbte_tipo, point_of_sale, number, status, issue_date, concept, service_from, service_to, doc_type, doc_number, iva_condition, receiver_name, total, lines, issuer, cae, cae_due, cancels_invoice_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (!inv || inv.status !== "issued" || !inv.cae) {
    return new NextResponse("Factura no encontrada", { status: 404 });
  }

  let associated: { label: string; date: string } | null = null;
  if (inv.cancels_invoice_id) {
    const { data: orig } = await supabase
      .from("invoices")
      .select("cbte_tipo, point_of_sale, number, issue_date")
      .eq("id", inv.cancels_invoice_id)
      .maybeSingle();
    if (orig) associated = { label: invoiceLabel(orig.cbte_tipo, orig.point_of_sale, Number(orig.number)), date: orig.issue_date };
  }

  const pdf = await invoicePdf({
    environment: inv.environment,
    cbte_tipo: inv.cbte_tipo,
    point_of_sale: inv.point_of_sale,
    number: Number(inv.number),
    issue_date: inv.issue_date,
    concept: inv.concept,
    service_from: inv.service_from,
    service_to: inv.service_to,
    doc_type: inv.doc_type,
    doc_number: inv.doc_number,
    iva_condition: inv.iva_condition,
    receiver_name: inv.receiver_name,
    total: Number(inv.total),
    lines: inv.lines,
    issuer: inv.issuer,
    cae: inv.cae,
    cae_due: inv.cae_due,
    associated,
  });
  const name = invoiceLabel(inv.cbte_tipo, inv.point_of_sale, Number(inv.number))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-");
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}

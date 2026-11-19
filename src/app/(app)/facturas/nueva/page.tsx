import Link from "next/link";
import { BackLink } from "@/components/back-link";
import { createClient } from "@/lib/supabase/server";
import { requireContactContext } from "@/lib/context";
import { fmtDate, fmtMoney, fullName } from "@/lib/format";
import { invoiceLabel } from "@/lib/arca/core";
import { InvoiceForm, type IssuerOption } from "./invoice-form";

type Conn = { id: string; holder_id: string; business_name: string; cuit: string; environment: string; status: string };
type Appt = {
  id: string;
  branch_id: string;
  status: string;
  scheduled_at: string;
  patient: { first_name: string; last_name: string | null; dni: string | null } | null;
  items: { zone: string | null; quantity: number | null; price: number | null; treatment: { name: string } | null; promotion: { name: string } | null }[];
  payments: { amount: number; exchange_rate: number | null; account: { currency: string; holder_id: string | null } | null }[];
};

const cuitFmt = (c: string) => `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}`;

// Emitir una Factura C: desde un turno atendido (?turno=…) o suelta (Números → Facturación)
export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ turno?: string }> }) {
  const ctx = await requireContactContext();
  const { turno } = await searchParams;
  const supabase = await createClient();

  const [{ data: connData }, apptRes, prevRes] = await Promise.all([
    supabase
      .from("arca_connections")
      .select("id, holder_id, business_name, cuit, environment, status")
      .eq("branch_id", ctx.currentBranch.id)
      .order("business_name"),
    turno
      ? supabase
          .from("appointments")
          .select(
            "id, branch_id, status, scheduled_at, patient:patients(first_name, last_name, dni), items:appointment_items(zone, quantity, price, treatment:treatments(name), promotion:promotions(name)), payments:appointment_payments(amount, exchange_rate, account:payment_accounts(currency, holder_id))",
          )
          .eq("id", turno)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    turno
      ? supabase
          .from("invoices")
          .select("id, cbte_tipo, point_of_sale, number, total, issue_date, cancels_invoice_id")
          .eq("appointment_id", turno)
          .eq("status", "issued")
          .order("created_at")
      : Promise.resolve({ data: null }),
  ]);

  const conns = ((connData ?? []) as Conn[]).filter((c) => c.status === "ready");
  const appt = (apptRes.data ?? null) as unknown as Appt | null;
  const back = appt ? `/turnos/${appt.id}` : ctx.canManageCurrentBranch ? "/facturacion" : "/";

  if (turno && (!appt || appt.branch_id !== ctx.currentBranch.id || appt.status !== "completed")) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <BackLink fallback={back} />
        <div className="card space-y-2">
          <h1>No se puede facturar este turno</h1>
          <p className="text-sm text-muted">Solo se factura un turno atendido de esta sucursal. Registrá la atención primero.</p>
        </div>
      </div>
    );
  }

  if (conns.length === 0) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <BackLink fallback={back} />
        <div className="card space-y-3">
          <h1>Nadie factura todavía desde el CRM</h1>
          <p className="text-sm text-muted">
            Para emitir facturas, cada titular de cuenta conecta su CUIT con ARCA una sola vez.
          </p>
          {ctx.canManageCurrentBranch ? (
            <Link href="/ajustes#factura-electronica" className="btn btn-primary">Conectar ARCA</Link>
          ) : (
            <p className="text-sm">Pedíselo al franquiciado: se hace en Ajustes → Factura electrónica.</p>
          )}
        </div>
      </div>
    );
  }

  // Lo que cobró cada titular en el turno y las líneas que se proponen
  const issuers: IssuerOption[] = conns.map((c) => {
    let amount: number | null = null;
    let lines: IssuerOption["lines"] = [];
    if (appt) {
      amount = appt.payments
        .filter((p) => p.account?.holder_id === c.holder_id && p.account?.currency === "ARS")
        .reduce((s, p) => s + Number(p.amount), 0);
      const items = appt.items.filter((i) => Number(i.price ?? 0) > 0);
      const itemsTotal = items.reduce((s, i) => s + Number(i.price), 0);
      const describe = (i: Appt["items"][number]) =>
        [i.promotion?.name ?? i.treatment?.name ?? "Tratamiento", i.zone].filter(Boolean).join(" · ");
      if (amount > 0 && Math.abs(amount - itemsTotal) < 0.01) {
        lines = items.map((i) => ({ description: describe(i), quantity: 1, unit_price: Number(i.price) }));
      } else if (amount > 0) {
        // Cobró solo una parte: una línea con lo que entró en sus cuentas
        lines = [{ description: items.map(describe).join(", ") || "Tratamiento estético", quantity: 1, unit_price: amount }];
      } else {
        lines = items.map((i) => ({ description: describe(i), quantity: 1, unit_price: Number(i.price) }));
      }
    }
    return {
      id: c.id,
      label: `${c.business_name} · ${cuitFmt(c.cuit)}`,
      test: c.environment === "test",
      amount: amount && amount > 0 ? amount : null,
      lines,
    };
  });
  const defaultIssuer = [...issuers].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))[0]?.id ?? issuers[0].id;
  const previous = (prevRes.data ?? []) as {
    id: string;
    cbte_tipo: number;
    point_of_sale: number;
    number: number;
    total: number;
    issue_date: string;
  }[];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <BackLink fallback={back} />
      <div>
        <h1>{appt?.patient ? `Facturar a ${fullName(appt.patient)}` : "Nueva factura"}</h1>
        <p className="page-sub">
          {appt ? `Turno del ${fmtDate(appt.scheduled_at)}. ` : ""}Factura C electrónica de ARCA, con el CUIT de quien factura.
        </p>
      </div>
      {previous.length > 0 && (
        <div className="rounded-xl border border-warn-line bg-warn-soft px-4 py-3 text-sm">
          <p className="font-semibold text-warn">Este turno ya tiene comprobantes:</p>
          <ul className="mt-1 space-y-0.5">
            {previous.map((p) => (
              <li key={p.id}>
                <Link href={`/facturas/${p.id}`} className="link">
                  {invoiceLabel(p.cbte_tipo, p.point_of_sale, Number(p.number))}
                </Link>{" "}
                · {fmtMoney(p.total)} · {fmtDate(p.issue_date)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <InvoiceForm
        issuers={issuers}
        defaultIssuer={defaultIssuer}
        appointmentId={appt?.id ?? null}
        defaultConcept={appt ? "servicios" : "productos"}
        patient={appt?.patient ? { name: fullName(appt.patient), dni: appt.patient.dni ?? "" } : null}
      />
    </div>
  );
}

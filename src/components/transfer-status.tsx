import { fmtMoney, fmtTime } from "@/lib/format";

// Estado de la verificación en Mercado Pago de cada cobro por transferencia de un turno
export type TransferCheck = {
  status: "pending" | "verified" | "review" | "not_found";
  amount: number;
  is_deposit: boolean;
  matched_by: "dni" | "amount" | null;
  transfer_at: string | null;
  note: string | null;
  account: { name: string } | null;
};

type Db = Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

// Chequeos por turno. Consulta aparte y tolerante: si falla, el resto de la pantalla no se rompe.
export async function loadTransferChecks(supabase: Db, appointmentIds: string[]) {
  const out = new Map<string, TransferCheck[]>();
  if (appointmentIds.length === 0) return out;
  const { data, error } = await supabase
    .from("transfer_checks")
    .select("appointment_id, status, amount, is_deposit, matched_by, transfer_at, note, account:payment_accounts(name)")
    .in("appointment_id", appointmentIds);
  if (error || !data) return out;
  for (const row of data as unknown as (TransferCheck & { appointment_id: string })[]) {
    out.set(row.appointment_id, [...(out.get(row.appointment_id) ?? []), row]);
  }
  return out;
}

const TEXT = {
  verified: { cls: "text-ok", icon: "✓", label: "llegó" },
  pending: { cls: "text-warn", icon: "…", label: "esperando la transferencia en Mercado Pago" },
  review: { cls: "text-bad", icon: "!", label: "revisar en Mercado Pago" },
  not_found: { cls: "text-bad", icon: "✕", label: "no llegó ninguna transferencia por ese monto" },
};

export function TransferStatus({ checks, compact = false }: { checks: TransferCheck[]; compact?: boolean }) {
  if (!checks?.length) return null;
  return (
    <ul className={compact ? "space-y-0.5" : "space-y-1"}>
      {checks.map((c, i) => {
        const t = TEXT[c.status];
        const label =
          c.status === "verified"
            ? `${c.matched_by === "amount" ? "llegó (verificada por monto)" : "transferencia verificada"}${
                c.transfer_at ? ` a las ${fmtTime(c.transfer_at)}` : ""
              }`
            : t.label;
        return (
          <li key={i} className={`text-xs ${t.cls}`}>
            <span aria-hidden="true" className="inline-block w-3 font-semibold">{t.icon}</span>{" "}
            <span className="font-semibold">
              {c.is_deposit ? "Seña " : ""}
              {c.account?.name ?? "MP"} {fmtMoney(c.amount)}
            </span>
            : {label}
            {c.note && !compact && <span className="block pl-4 text-muted">{c.note}</span>}
          </li>
        );
      })}
    </ul>
  );
}

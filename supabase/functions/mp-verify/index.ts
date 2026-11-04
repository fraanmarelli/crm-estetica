// Verifica en Mercado Pago las transferencias de los cobros cargados en cuentas conectadas.
// La llama el cron cada minuto (migración 20261104001400_mp_verify_cron.sql).
// Solo lectura en MP. Nunca loguea datos de pacientes ni tokens.

import { createClient } from "npm:@supabase/supabase-js@2";
import { digits, matchTransfers, WINDOW_MS, type Check, type Transfer } from "./match.ts";

const MP_API = "https://api.mercadopago.com";
const RENEW_BEFORE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_HOURS = 15 * 24;

type MpPayment = {
  id: number;
  status: string;
  operation_type: string;
  currency_id: string;
  transaction_amount: number;
  date_created: string;
  date_approved?: string | null;
  payer?: { identification?: { number?: string | null } | null } | null;
  point_of_interaction?: {
    type?: string;
    transaction_data?: { bank_info?: { is_same_bank_account_owner?: boolean | null } | null } | null;
  } | null;
};

// account_fund: de un banco al CVU · money_transfer: desde otra cuenta de MP
const TRANSFER_OPS = new Set(["account_fund", "money_transfer"]);
const isIncomingTransfer = (p: MpPayment) =>
  p.status === "approved" &&
  p.currency_id === "ARS" &&
  TRANSFER_OPS.has(p.operation_type) &&
  p.point_of_interaction?.type === "PSP_TRANSFER" &&
  p.point_of_interaction?.transaction_data?.bank_info?.is_same_bank_account_owner !== true;

async function searchTransfers(token: string, hours: number): Promise<Transfer[]> {
  const out: Transfer[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const params = new URLSearchParams({
      sort: "date_created",
      criteria: "desc",
      range: "date_created",
      begin_date: `NOW-${hours}HOURS`,
      end_date: "NOW",
      status: "approved",
      limit: "100",
      offset: String(offset),
    });
    const res = await fetch(`${MP_API}/v1/payments/search?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Mercado Pago respondió ${res.status} al buscar pagos`);
    const data = (await res.json()) as { results: MpPayment[]; paging: { total: number } };
    for (const p of data.results.filter(isIncomingTransfer)) {
      out.push({
        id: String(p.id),
        cents: Math.round(p.transaction_amount * 100),
        cuit: digits(p.payer?.identification?.number),
        at: new Date(p.date_approved || p.date_created),
      });
    }
    if (offset + 100 >= data.paging.total) break;
  }
  return out;
}

async function refreshToken(refresh: string) {
  const res = await fetch(`${MP_API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: Deno.env.get("MP_CLIENT_ID"),
      client_secret: Deno.env.get("MP_CLIENT_SECRET"),
      grant_type: "refresh_token",
      refresh_token: refresh,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`No se pudo renovar el acceso a Mercado Pago (${res.status})`);
  return {
    access_token: data.access_token as string,
    refresh_token: (data.refresh_token as string | undefined) ?? refresh,
    expires_at: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
  };
}

Deno.serve(async (req) => {
  const expected = Deno.env.get("DISPATCH_SECRET");
  if (!expected || req.headers.get("x-dispatch-secret") !== expected) {
    return new Response("unauthorized", { status: 401 });
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  await db.rpc("cleanup_transfer_checks");

  const { data: pending, error } = await db
    .from("transfer_checks")
    .select("id, account_id, amount, created_at, appointment:appointments(patient:patients(dni))")
    .eq("status", "pending")
    .limit(500);
  if (error) return new Response(error.message, { status: 500 });
  if (!pending?.length) return Response.json({ checked: 0 });

  const byAccount = new Map<string, typeof pending>();
  for (const c of pending) byAccount.set(c.account_id, [...(byAccount.get(c.account_id) ?? []), c]);

  const { data: connections } = await db
    .from("mp_connections")
    .select("id, account_id, token_expires_at, secret:mp_connection_secrets(access_token, refresh_token)")
    .in("account_id", [...byAccount.keys()])
    .eq("is_active", true);

  let verified = 0;
  for (const conn of connections ?? []) {
    const secret = Array.isArray(conn.secret) ? conn.secret[0] : conn.secret;
    const rows = byAccount.get(conn.account_id) ?? [];
    if (!secret?.access_token || rows.length === 0) continue;

    try {
      let token = secret.access_token as string;
      const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : null;
      if (expiresAt && secret.refresh_token && expiresAt - Date.now() < RENEW_BEFORE_MS) {
        const fresh = await refreshToken(secret.refresh_token);
        token = fresh.access_token;
        await db
          .from("mp_connection_secrets")
          .update({ access_token: fresh.access_token, refresh_token: fresh.refresh_token, updated_at: new Date().toISOString() })
          .eq("connection_id", conn.id);
        await db.from("mp_connections").update({ token_expires_at: fresh.expires_at }).eq("id", conn.id);
      }

      const oldest = Math.min(...rows.map((r) => new Date(r.created_at).getTime()));
      const hours = Math.min(Math.ceil((Date.now() - oldest + WINDOW_MS) / 3_600_000), MAX_HOURS);
      const transfers = await searchTransfers(token, hours);

      // Transferencias que ya validaron otro cobro
      const ids = transfers.map((t) => t.id);
      const used = new Set<string>();
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await db.from("transfer_checks").select("mp_payment_id").in("mp_payment_id", ids.slice(i, i + 200));
        for (const u of data ?? []) used.add(u.mp_payment_id as string);
      }

      const checks: Check[] = rows.map((r) => {
        const appt = Array.isArray(r.appointment) ? r.appointment[0] : r.appointment;
        const patient = appt && (Array.isArray(appt.patient) ? appt.patient[0] : appt.patient);
        return {
          id: r.id,
          cents: Math.round(Number(r.amount) * 100),
          dni: digits(patient?.dni ?? null),
          createdAt: new Date(r.created_at),
        };
      });

      const now = new Date().toISOString();
      for (const o of matchTransfers(transfers.filter((t) => !used.has(t.id)), checks)) {
        if (o.status === "pending") continue;
        const patch =
          o.status === "verified"
            ? {
                status: "verified",
                mp_payment_id: o.transfer.id,
                matched_by: o.matchedBy,
                transfer_at: o.transfer.at.toISOString(),
                note: o.note,
                checked_at: now,
              }
            : { status: o.status, note: o.note, checked_at: now };
        // Si otra corrida ya usó esa transferencia, el unique lo frena y queda pendiente
        const { error: upErr } = await db.from("transfer_checks").update(patch).eq("id", o.checkId).eq("status", "pending");
        if (!upErr && o.status === "verified") verified++;
      }
      await db.from("mp_connections").update({ last_checked_at: now, last_error: null }).eq("id", conn.id);
    } catch (err) {
      await db
        .from("mp_connections")
        .update({ last_checked_at: new Date().toISOString(), last_error: err instanceof Error ? err.message : "Error" })
        .eq("id", conn.id);
    }
  }

  return Response.json({ checked: pending.length, verified });
});

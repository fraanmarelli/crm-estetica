// Trae de Meta el gasto y los resultados por campaña de cada sucursal conectada.
// Lo llama el cron todos los días (migración 20261103000300_marketing_cron.sql).
// Re-sincroniza los últimos días porque Meta corrige números hacia atrás.

import { createClient } from "npm:@supabase/supabase-js@2";

const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v23.0";
const TZ = "America/Argentina/Buenos_Aires";
const MESSAGE_ACTIONS = new Set([
  "onsite_conversion.messaging_conversation_started_7d",
]);
const LEAD_ACTIONS = ["lead", "onsite_conversion.lead_grouped"];

type Connection = {
  connection_id: string;
  organization_id: string;
  branch_id: string;
  ad_account_id: string;
  access_token: string;
  last_synced_at: string | null;
};

type InsightRow = {
  campaign_id: string;
  campaign_name?: string;
  date_start: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  actions?: { action_type: string; value: string }[];
};

function isoDay(offsetDays: number): string {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const d = new Date(`${today}T12:00:00-03:00`);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function countActions(actions: InsightRow["actions"]) {
  let messages = 0;
  const leadsByType: Record<string, number> = {};
  for (const a of actions ?? []) {
    const value = Number(a.value) || 0;
    if (MESSAGE_ACTIONS.has(a.action_type)) messages += value;
    if (LEAD_ACTIONS.includes(a.action_type)) leadsByType[a.action_type] = value;
  }
  // "lead" ya incluye a los agrupados: se toma uno solo para no contar dos veces
  const leads = leadsByType["lead"] ?? leadsByType["onsite_conversion.lead_grouped"] ?? 0;
  return { messages, leads };
}

async function fetchInsights(c: Connection, since: string, until: string): Promise<InsightRow[]> {
  const params = new URLSearchParams({
    level: "campaign",
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    fields: "campaign_id,campaign_name,spend,impressions,reach,clicks,actions",
    limit: "500",
    access_token: c.access_token,
  });
  let url: string | null = `https://graph.facebook.com/${GRAPH_VERSION}/act_${c.ad_account_id}/insights?${params}`;
  const rows: InsightRow[] = [];

  while (url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    const body = await res.json();
    if (!res.ok || body.error) {
      const e = body.error ?? {};
      // 190 = token vencido o revocado: la sucursal tiene que reconectar
      const expired = e.code === 190;
      throw new Error(expired ? "TOKEN_EXPIRED" : `Meta ${e.code ?? res.status}: ${e.message ?? "error"}`);
    }
    rows.push(...(body.data ?? []));
    url = body.paging?.next ?? null;
  }
  return rows;
}

Deno.serve(async (req) => {
  const expected = Deno.env.get("DISPATCH_SECRET");
  if (!expected || req.headers.get("x-dispatch-secret") !== expected) {
    return new Response("unauthorized", { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await supabase.rpc("ad_connections_to_sync");
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const results: { account: string; rows?: number; error?: string }[] = [];

  for (const c of (data ?? []) as Connection[]) {
    // Primera vez: últimos 90 días. Después: últimos 7 (Meta ajusta datos recientes).
    const since = isoDay(c.last_synced_at ? -7 : -90);
    const until = isoDay(-1);

    try {
      const rows = await fetchInsights(c, since, until);
      const records = rows.map((r) => {
        const { messages, leads } = countActions(r.actions);
        return {
          organization_id: c.organization_id,
          branch_id: c.branch_id,
          connection_id: c.connection_id,
          date: r.date_start,
          campaign_id: r.campaign_id,
          campaign_name: r.campaign_name ?? null,
          spend: Number(r.spend ?? 0),
          impressions: Number(r.impressions ?? 0),
          reach: Number(r.reach ?? 0),
          clicks: Number(r.clicks ?? 0),
          messages,
          leads,
          synced_at: new Date().toISOString(),
        };
      });

      // Reemplaza el período sincronizado (borra campañas que ya no tienen datos)
      const { error: delErr } = await supabase
        .from("ad_insights_daily")
        .delete()
        .eq("connection_id", c.connection_id)
        .gte("date", since)
        .lte("date", until);
      if (delErr) throw new Error(delErr.message);

      for (let i = 0; i < records.length; i += 500) {
        const { error: insErr } = await supabase.from("ad_insights_daily").insert(records.slice(i, i + 500));
        if (insErr) throw new Error(insErr.message);
      }

      await supabase
        .from("ad_connections")
        .update({ last_synced_at: new Date().toISOString(), last_error: null })
        .eq("id", c.connection_id);
      results.push({ account: c.ad_account_id, rows: records.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await supabase
        .from("ad_connections")
        .update({
          last_error:
            message === "TOKEN_EXPIRED"
              ? "La conexión con Facebook venció. Tocá «Reconectar»."
              : message.slice(0, 500),
        })
        .eq("id", c.connection_id);
      results.push({ account: c.ad_account_id, error: message });
    }
  }

  return Response.json({ ok: true, results });
});

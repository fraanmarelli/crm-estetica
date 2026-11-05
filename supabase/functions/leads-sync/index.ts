// Busca en Meta los formularios nuevos de cada página conectada (cada 5 minutos, por cron).
// Respaldo del webhook: funciona aunque la app de Meta no esté publicada.
// No loguea datos personales ni tokens.

import { createClient } from "npm:@supabase/supabase-js@2";

const GRAPH = `https://graph.facebook.com/${Deno.env.get("META_GRAPH_VERSION") ?? "v23.0"}`;
const OVERLAP_MS = 15 * 60 * 1000; // vuelve a mirar 15 minutos para atrás (Meta a veces demora)
const FIRST_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const LEAD_FIELDS = "id,created_time,field_data,ad_id,ad_name,campaign_id,campaign_name,form_id,platform";

type MetaLead = {
  id: string;
  created_time: string;
  field_data?: { name: string; values: string[] }[];
  ad_id?: string;
  ad_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  form_id?: string;
  platform?: string;
};

// Misma lectura que src/lib/meta-leads.ts (parseLead)
const NAME_KEYS = ["full_name", "nombre_completo", "nombre_y_apellido", "nombre", "first_name"];
const LAST_KEYS = ["last_name", "apellido"];
const PHONE_KEYS = ["phone_number", "telefono", "teléfono", "celular", "whatsapp", "numero_de_telefono", "número_de_teléfono"];
const EMAIL_KEYS = ["email", "correo", "correo_electronico", "correo_electrónico", "mail"];
const pretty = (text: string) =>
  text.replace(/_/g, " ").replace(/\s+/g, " ").trim().replace(/\p{L}/u, (c) => c.toUpperCase());

function parseLead(l: MetaLead, formName: string | null) {
  const fields = l.field_data ?? [];
  const pick = (keys: string[]) => fields.find((f) => keys.includes(f.name.toLowerCase()))?.values?.[0]?.trim() || null;
  const first = pick(NAME_KEYS);
  const last = pick(LAST_KEYS);
  const known = new Set([...NAME_KEYS, ...LAST_KEYS, ...PHONE_KEYS, ...EMAIL_KEYS]);
  return {
    external_id: l.id,
    created_at: l.created_time ? new Date(l.created_time).toISOString() : new Date().toISOString(),
    full_name: [first, last].filter(Boolean).join(" ") || null,
    phone: pick(PHONE_KEYS),
    email: pick(EMAIL_KEYS),
    answers: fields
      .filter((f) => !known.has(f.name.toLowerCase()))
      .map((f) => ({ pregunta: pretty(f.name), respuesta: pretty((f.values ?? []).join(", ")) })),
    form_id: l.form_id ?? null,
    form_name: formName,
    ad_id: l.ad_id ?? null,
    ad_name: l.ad_name ?? null,
    campaign_id: l.campaign_id ?? null,
    campaign_name: l.campaign_name ?? null,
    platform: l.platform ?? null,
  };
}

async function graph<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(body.error?.message ?? `Meta respondió ${res.status}`);
  return body as T;
}

async function leadsSince(pageId: string, token: string, sinceMs: number) {
  const since = Math.floor(sinceMs / 1000);
  const forms = await graph<{ data: { id: string; name: string }[] }>(
    `${GRAPH}/${pageId}/leadgen_forms?${new URLSearchParams({ fields: "id,name", limit: "100", access_token: token })}`,
  );
  const out: ReturnType<typeof parseLead>[] = [];
  for (const f of forms.data ?? []) {
    let url: string | null = `${GRAPH}/${f.id}/leads?${new URLSearchParams({
      fields: LEAD_FIELDS,
      limit: "100",
      filtering: JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: since }]),
      access_token: token,
    })}`;
    while (url && out.length < 2000) {
      const body: { data: MetaLead[]; paging?: { next?: string } } = await graph(url);
      for (const l of body.data ?? []) out.push(parseLead({ ...l, form_id: l.form_id ?? f.id }, f.name));
      url = body.paging?.next ?? null;
    }
  }
  return out;
}

Deno.serve(async (req) => {
  const expected = Deno.env.get("DISPATCH_SECRET");
  if (!expected || req.headers.get("x-dispatch-secret") !== expected) {
    return new Response("unauthorized", { status: 401 });
  }
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const { data: pages, error } = await db
    .from("lead_pages")
    .select("id, organization_id, branch_id, page_id, last_synced_at, secret:lead_page_secrets(page_token)");
  if (error) return new Response(error.message, { status: 500 });

  let imported = 0;
  for (const p of pages ?? []) {
    const secret = Array.isArray(p.secret) ? p.secret[0] : p.secret;
    if (!secret?.page_token) continue;
    const startedAt = Date.now();
    const since = p.last_synced_at ? new Date(p.last_synced_at).getTime() - OVERLAP_MS : startedAt - FIRST_LOOKBACK_MS;
    try {
      const leads = await leadsSince(p.page_id, secret.page_token, since);
      for (let i = 0; i < leads.length; i += 200) {
        const batch = leads.slice(i, i + 200).map((l) => ({ ...l, organization_id: p.organization_id, branch_id: p.branch_id }));
        const { error: insErr } = await db
          .from("leads")
          .upsert(batch, { onConflict: "organization_id,external_id", ignoreDuplicates: true });
        if (insErr) throw new Error(insErr.message);
      }
      imported += leads.length;
      await db
        .from("lead_pages")
        .update({
          last_synced_at: new Date(startedAt).toISOString(),
          last_error: null,
          ...(leads.length ? { last_lead_at: new Date().toISOString() } : {}),
        })
        .eq("id", p.id);
    } catch (err) {
      await db
        .from("lead_pages")
        .update({ last_error: err instanceof Error ? err.message.slice(0, 300) : "Error" })
        .eq("id", p.id);
    }
  }
  return Response.json({ pages: pages?.length ?? 0, seen: imported });
});

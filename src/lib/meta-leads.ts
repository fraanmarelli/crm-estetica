import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { META_GRAPH_VERSION, appUrl } from "@/lib/meta";

// Leads de los formularios instantáneos de Meta: conexión de la página, webhook y lectura.
export const META_LEADS_COOKIE = "crm_meta_leads_oauth";
export const LEAD_SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_metadata", "leads_retrieval", "ads_management"];

export function leadsConfigured(): boolean {
  return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function leadsRedirectUri(requestOrigin: string): string {
  return `${appUrl(requestOrigin)}/api/meta/leads/callback`;
}

async function graph<T>(path: string, params: Record<string, string>, method: "GET" | "POST" = "GET"): Promise<T> {
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { method, cache: "no-store" });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(body.error?.message ?? `Meta respondió ${res.status}`);
  return body as T;
}

// Páginas que administra el usuario, con su token de página (no vence si viene de un token largo)
export async function listPages(userToken: string) {
  const body = await graph<{ data: { id: string; name: string; access_token: string; tasks?: string[] }[] }>(
    "me/accounts",
    { fields: "id,name,access_token,tasks", limit: "100", access_token: userToken },
  );
  return (body.data ?? []).map((p) => ({ id: p.id, name: p.name, access_token: p.access_token, tasks: p.tasks ?? [] }));
}

// Que Meta avise a la app cada formulario nuevo de esta página
export async function subscribePage(pageId: string, pageToken: string) {
  await graph(`${pageId}/subscribed_apps`, { subscribed_fields: "leadgen", access_token: pageToken }, "POST");
}

export async function unsubscribePage(pageId: string, pageToken: string) {
  try {
    await fetch(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/${pageId}/subscribed_apps?${new URLSearchParams({ access_token: pageToken })}`,
      { method: "DELETE", cache: "no-store" },
    );
  } catch {
    // Si falla, Meta igual deja de mandar cuando la página no está en el CRM (se ignora)
  }
}

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
const LEAD_FIELDS = "id,created_time,field_data,ad_id,ad_name,campaign_id,campaign_name,form_id,platform";

// Campos conocidos del formulario; el resto queda como pregunta/respuesta
const NAME_KEYS = ["full_name", "nombre_completo", "nombre_y_apellido", "nombre", "first_name"];
const LAST_KEYS = ["last_name", "apellido"];
const PHONE_KEYS = ["phone_number", "telefono", "teléfono", "celular", "whatsapp", "numero_de_telefono", "número_de_teléfono"];
const EMAIL_KEYS = ["email", "correo", "correo_electronico", "correo_electrónico", "mail"];

// "¿qué_tratamiento_te_interesa?" → "¿Qué tratamiento te interesa?"
function pretty(text: string) {
  const t = text.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return t.replace(/\p{L}/u, (c) => c.toUpperCase());
}

export function parseLead(l: MetaLead, formName: string | null) {
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

export async function fetchLead(leadgenId: string, pageToken: string) {
  return graph<MetaLead>(leadgenId, { fields: LEAD_FIELDS, access_token: pageToken });
}

async function formName(formId: string, pageToken: string): Promise<string | null> {
  try {
    return (await graph<{ name?: string }>(formId, { fields: "name", access_token: pageToken })).name ?? null;
  } catch {
    return null;
  }
}

export async function fetchParsedLead(leadgenId: string, pageToken: string) {
  const lead = await fetchLead(leadgenId, pageToken);
  return parseLead(lead, lead.form_id ? await formName(lead.form_id, pageToken) : null);
}

// Al conectar: trae los leads de los últimos días de todos los formularios de la página
export async function recentLeads(pageId: string, pageToken: string, days = 30) {
  const since = Math.floor((Date.now() - days * 86_400_000) / 1000);
  const forms = await graph<{ data: { id: string; name: string }[] }>(`${pageId}/leadgen_forms`, {
    fields: "id,name",
    limit: "100",
    access_token: pageToken,
  });
  const out: ReturnType<typeof parseLead>[] = [];
  for (const f of forms.data ?? []) {
    let next: string | null = null;
    let first = true;
    while (first || next) {
      first = false;
      const body: { data: MetaLead[]; paging?: { next?: string } } = next
        ? await (await fetch(next, { cache: "no-store" })).json()
        : await graph(`${f.id}/leads`, {
            fields: LEAD_FIELDS,
            limit: "100",
            filtering: JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: since }]),
            access_token: pageToken,
          });
      for (const l of body.data ?? []) out.push(parseLead({ ...l, form_id: l.form_id ?? f.id }, f.name));
      next = body.paging?.next ?? null;
      if (out.length > 2000) break;
    }
  }
  return out;
}

// Firma de los avisos de Meta: X-Hub-Signature-256 = sha256 HMAC del cuerpo con el secreto de la app
export function validSignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const got = header.slice(7);
  return got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

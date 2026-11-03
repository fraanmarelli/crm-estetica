// Envía los eventos pendientes del outbox a cada integración.
// Lo llama el cron de la base cada minuto (migración 20261103000100_cron_dispatch.sql).
//
// Para sumar una automatización nueva: agregá un handler en HANDLERS con el
// "type" de la integración. Nada más cambia.

import { createClient } from "npm:@supabase/supabase-js@2";

type OutboxEvent = {
  id: number;
  event_type: string;
  integration_type: string;
  config: Record<string, unknown>;
  secret: string | null;
  payload: Record<string, unknown>;
};

type Handler = (event: OutboxEvent) => Promise<void>;

const HANDLERS: Record<string, Handler> = {
  // Google Sheets vía Apps Script (Code.gs)
  google_sheets: async (event) => {
    const url = String(event.config.url ?? "");
    if (!url.startsWith("https://script.google.com/")) {
      throw new Error("config.url debe ser la URL de la aplicación web de Apps Script");
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: event.secret, evento: event.event_type, ...event.payload }),
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);

    let body: { ok?: boolean; error?: string };
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`Respuesta no JSON de Apps Script: ${text.slice(0, 300)}`);
    }
    if (!body.ok) throw new Error(body.error ?? "Apps Script respondió ok=false");
  },

  // Klaviyo: un evento "Tratamiento realizado" por cada ítem del turno, con la fecha en que
  // vence. En Klaviyo se arma un flow por tratamiento disparado por ese evento.
  // Solo se envía si la paciente aceptó recibir comunicaciones y tiene email.
  klaviyo: async (event) => {
    if (event.event_type !== "appointment.completed") return;
    const p = event.payload as KlaviyoPayload;
    if (!p.acepta_marketing || !p.email || !event.secret) return;

    const headers = {
      Authorization: `Klaviyo-API-Key ${event.secret}`,
      revision: KLAVIYO_REVISION,
      accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
    };

    const nextDates: Record<string, string> = {};
    for (const item of p.items) {
      if (item.proximo_vencimiento) nextDates[`proximo_${slug(item.tratamiento)}`] = item.proximo_vencimiento;
    }

    const profile = {
      type: "profile",
      attributes: {
        email: p.email,
        ...(p.telefono ? { phone_number: `+${p.telefono}` } : {}),
        first_name: p.nombre,
        ...(p.apellido ? { last_name: p.apellido } : {}),
        properties: { sucursal: p.sucursal, paciente_id: p.paciente_id, ...nextDates },
      },
    };

    for (const item of p.items) {
      const res = await fetch("https://a.klaviyo.com/api/events", {
        method: "POST",
        headers,
        body: JSON.stringify({
          data: {
            type: "event",
            attributes: {
              unique_id: `${p.id_crm}-${item.tratamiento_id}`,
              time: p.fecha_iso,
              value: item.precio ?? undefined,
              properties: {
                tratamiento: item.tratamiento,
                tipo: item.tipo,
                categoria: item.categoria,
                zona: item.zona,
                sucursal: p.sucursal,
                profesional: p.profesional,
                dias_para_repetir: item.dias_recall,
                proximo_vencimiento: item.proximo_vencimiento,
              },
              metric: { data: { type: "metric", attributes: { name: "Tratamiento realizado" } } },
              profile: { data: profile },
            },
          },
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Klaviyo ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }

    // Opcional: suscribir a una lista de email marketing (config.list_id)
    const listId = String(event.config.list_id ?? "");
    if (listId) {
      const res = await fetch("https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs", {
        method: "POST",
        headers,
        body: JSON.stringify({
          data: {
            type: "profile-subscription-bulk-create-job",
            attributes: {
              profiles: {
                data: [
                  {
                    type: "profile",
                    attributes: {
                      email: p.email,
                      subscriptions: { email: { marketing: { consent: "SUBSCRIBED" } } },
                    },
                  },
                ],
              },
            },
            relationships: { list: { data: { type: "list", id: listId } } },
          },
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Klaviyo (lista) ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
  },
};

const KLAVIYO_REVISION = Deno.env.get("KLAVIYO_REVISION") ?? "2025-07-15";

type KlaviyoPayload = {
  id_crm: string;
  fecha_iso: string;
  sucursal: string;
  paciente_id: string;
  nombre: string;
  apellido: string | null;
  telefono: string | null;
  email: string | null;
  acepta_marketing: boolean;
  profesional: string | null;
  items: {
    tratamiento_id: string;
    tratamiento: string;
    tipo: string;
    categoria: string | null;
    zona: string | null;
    precio: number | null;
    dias_recall: number | null;
    proximo_vencimiento: string | null;
  }[];
};

function slug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
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

  const { data, error } = await supabase.rpc("claim_outbox_events", { p_limit: 25 });
  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  const events = (data ?? []) as OutboxEvent[];
  let sent = 0;
  let failed = 0;

  // En orden y de a uno: la planilla no admite escrituras en paralelo
  for (const event of events) {
    const handler = HANDLERS[event.integration_type];
    try {
      if (!handler) throw new Error(`Sin handler para "${event.integration_type}"`);
      await handler(event);
      await supabase.rpc("finish_outbox_event", { p_id: event.id, p_ok: true });
      sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await supabase.rpc("finish_outbox_event", { p_id: event.id, p_ok: false, p_error: message });
      failed++;
    }
  }

  return Response.json({ ok: true, processed: events.length, sent, failed });
});

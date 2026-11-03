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
};

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

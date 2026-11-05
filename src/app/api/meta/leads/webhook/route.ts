import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchParsedLead, validSignature } from "@/lib/meta-leads";

// Verificación del webhook (Meta la pide una vez al configurarlo)
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (expected && p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === expected) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

type Change = { field: string; value: { leadgen_id?: string; page_id?: string } };

// Cada formulario nuevo: Meta manda el id del lead; lo traemos con el token de la página y lo guardamos.
// No se loguean datos personales. Si algo falla, respondemos 500 y Meta reintenta.
export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!validSignature(raw, request.headers.get("x-hub-signature-256"))) {
    return new NextResponse("bad signature", { status: 401 });
  }
  let body: { object?: string; entry?: { changes?: Change[] }[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse("bad json", { status: 400 });
  }
  if (body.object !== "page") return NextResponse.json({ ok: true });

  const admin = createAdminClient();
  let failed = false;
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const { leadgen_id: leadgenId, page_id: pageId } = change.value ?? {};
      if (change.field !== "leadgen" || !leadgenId || !pageId) continue;

      const { data: page } = await admin
        .from("lead_pages")
        .select("id, organization_id, branch_id, secret:lead_page_secrets(page_token)")
        .eq("page_id", pageId)
        .maybeSingle();
      const secret = page && (Array.isArray(page.secret) ? page.secret[0] : page.secret);
      if (!page || !secret?.page_token) continue; // página que no está en el CRM

      try {
        const lead = await fetchParsedLead(leadgenId, secret.page_token);
        const { error } = await admin
          .from("leads")
          .upsert(
            { ...lead, organization_id: page.organization_id, branch_id: page.branch_id },
            { onConflict: "organization_id,external_id", ignoreDuplicates: true },
          );
        if (error) throw new Error(error.message);
        await admin.from("lead_pages").update({ last_lead_at: new Date().toISOString(), last_error: null }).eq("id", page.id);
      } catch (err) {
        failed = true;
        await admin
          .from("lead_pages")
          .update({ last_error: err instanceof Error ? err.message.slice(0, 300) : "Error" })
          .eq("id", page.id);
      }
    }
  }
  return failed ? new NextResponse("retry", { status: 500 }) : NextResponse.json({ ok: true });
}

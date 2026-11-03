// Mail semanal: cada lunes, a la marca (todas las sucursales) y a cada
// franquiciado (su sucursal). Lo llama el cron (20261103000300_marketing_cron.sql).
// Envía con Resend (https://resend.com). Pacientes nunca reciben este mail.

import { createClient } from "npm:@supabase/supabase-js@2";

type BranchRow = {
  branch_id: string;
  branch: string;
  done: number;
  done_prev: number;
  revenue: number;
  revenue_prev: number;
  new_patients: number;
  new_patients_prev: number;
  new_social: number;
  spend: number;
  spend_prev: number;
  messages: number;
  recall_due: number;
  recall_contacted: number;
  recall_booked: number;
  has_ads: boolean;
};

type Report = { from: string; to: string; branches: BranchRow[] };
type Recipient = { email: string; role: string; branch_id: string | null };

const n = (v: unknown) => Number(v ?? 0);

function money(v: number, currency: string) {
  return v.toLocaleString("es-AR", { style: "currency", currency, maximumFractionDigits: 0 });
}

function day(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

function delta(cur: number, prev: number) {
  if (!prev) return cur ? `<span style="color:#047857">nuevo</span>` : "";
  const pct = Math.round(((cur - prev) / prev) * 100);
  const color = pct >= 0 ? "#047857" : "#b91c1c";
  return `<span style="color:${color}">${pct >= 0 ? "+" : ""}${pct}%</span>`;
}

function costPer(spend: number, count: number, currency: string) {
  return count > 0 ? money(spend / count, currency) : "—";
}

function alertsFor(b: BranchRow): string[] {
  const out: string[] = [];
  if (n(b.done) === 0) out.push("no registró turnos realizados en la semana");
  if (n(b.spend) > 0 && n(b.new_social) === 0) out.push("invirtió en Meta y no sumó pacientes nuevas de redes");
  if (!b.has_ads) out.push("no tiene la cuenta de Meta conectada");
  if (n(b.recall_due) >= 10 && n(b.recall_contacted) === 0) {
    out.push(`tiene ${b.recall_due} pacientes para recontactar y no contactó a ninguna`);
  }
  return out;
}

const cell = "padding:8px 10px;border-bottom:1px solid #eee;font-size:13px;text-align:left";
const head = `${cell};color:#78716c;font-size:11px;text-transform:uppercase`;

function layout(title: string, body: string, appUrl: string, orgName: string) {
  return `<!doctype html><html><body style="margin:0;background:#f5f5f4;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1c1917">
  <div style="max-width:680px;margin:0 auto;padding:24px 16px">
    <p style="margin:0 0 4px;color:#a8325a;font-weight:600">${orgName}</p>
    <h1 style="margin:0 0 20px;font-size:20px">${title}</h1>
    ${body}
    <p style="margin:24px 0 0;font-size:12px;color:#78716c">
      <a href="${appUrl}" style="color:#a8325a">Abrir el CRM</a> · Mail automático semanal.
    </p>
  </div></body></html>`;
}

function card(label: string, value: string, sub = "") {
  return `<td style="background:#fff;border:1px solid #e7e5e4;border-radius:10px;padding:12px;vertical-align:top;width:33%">
    <div style="font-size:11px;color:#78716c">${label}</div>
    <div style="font-size:20px;font-weight:600;margin-top:4px">${value}</div>
    <div style="font-size:12px;color:#78716c;margin-top:2px">${sub}</div></td>`;
}

function branchEmail(b: BranchRow, report: Report, currency: string, appUrl: string, orgName: string) {
  const alerts = alertsFor(b);
  const body = `
  <table role="presentation" style="width:100%;border-spacing:8px;margin:0 -8px">
    <tr>
      ${card("Turnos realizados", String(n(b.done)), delta(n(b.done), n(b.done_prev)))}
      ${card("Facturado", money(n(b.revenue), currency), delta(n(b.revenue), n(b.revenue_prev)))}
      ${card("Pacientes nuevas", String(n(b.new_patients)), `${n(b.new_social)} de redes`)}
    </tr>
    <tr>
      ${card("Inversión en Meta", money(n(b.spend), currency), `${n(b.messages)} mensajes`)}
      ${card("Costo por paciente nueva", costPer(n(b.spend), n(b.new_social), currency), "de redes")}
      ${card("Recall", `${n(b.recall_contacted)} contactadas`, `${n(b.recall_booked)} reservaron · ${n(b.recall_due)} pendientes`)}
    </tr>
  </table>
  ${
    alerts.length
      ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px;margin-top:16px;font-size:13px">
          <b>Para revisar:</b> ${alerts.join("; ")}.</div>`
      : ""
  }`;
  return layout(`${b.branch} · semana del ${day(report.from)} al ${day(report.to)}`, body, appUrl, orgName);
}

function brandEmail(report: Report, currency: string, appUrl: string, orgName: string) {
  const t = report.branches.reduce(
    (a, b) => ({
      done: a.done + n(b.done),
      done_prev: a.done_prev + n(b.done_prev),
      revenue: a.revenue + n(b.revenue),
      revenue_prev: a.revenue_prev + n(b.revenue_prev),
      new_patients: a.new_patients + n(b.new_patients),
      new_social: a.new_social + n(b.new_social),
      spend: a.spend + n(b.spend),
    }),
    { done: 0, done_prev: 0, revenue: 0, revenue_prev: 0, new_patients: 0, new_social: 0, spend: 0 },
  );

  const rows = report.branches
    .map(
      (b, i) => `<tr>
      <td style="${cell}">${i + 1}. ${b.branch}</td>
      <td style="${cell}">${money(n(b.revenue), currency)} ${delta(n(b.revenue), n(b.revenue_prev))}</td>
      <td style="${cell}">${n(b.done)}</td>
      <td style="${cell}">${n(b.new_patients)} <span style="color:#78716c">(${n(b.new_social)} redes)</span></td>
      <td style="${cell}">${money(n(b.spend), currency)}</td>
      <td style="${cell}">${costPer(n(b.spend), n(b.new_social), currency)}</td>
      <td style="${cell}">${n(b.recall_contacted)}/${n(b.recall_due)}</td>
    </tr>`,
    )
    .join("");

  const alerts = report.branches
    .flatMap((b) => alertsFor(b).map((a) => `<li><b>${b.branch}</b>: ${a}</li>`))
    .join("");

  const body = `
  <table role="presentation" style="width:100%;border-spacing:8px;margin:0 -8px">
    <tr>
      ${card("Facturado", money(t.revenue, currency), delta(t.revenue, t.revenue_prev))}
      ${card("Turnos realizados", String(t.done), delta(t.done, t.done_prev))}
      ${card("Inversión en Meta", money(t.spend, currency), `${costPer(t.spend, t.new_social, currency)} por paciente de redes`)}
    </tr>
  </table>
  <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e7e5e4;border-radius:10px;margin-top:16px">
    <tr>
      <th style="${head}">Sucursal</th><th style="${head}">Facturado</th><th style="${head}">Turnos</th>
      <th style="${head}">Nuevas</th><th style="${head}">Meta</th><th style="${head}">Costo x paciente</th>
      <th style="${head}">Recall</th>
    </tr>
    ${rows}
  </table>
  ${
    alerts
      ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px 12px 4px;margin-top:16px;font-size:13px">
          <b>Para revisar</b><ul style="padding-left:18px">${alerts}</ul></div>`
      : ""
  }`;
  return layout(`Resumen de la marca · semana del ${day(report.from)} al ${day(report.to)}`, body, appUrl, orgName);
}

async function send(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: Deno.env.get("REPORT_FROM"), to: [to], subject, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

Deno.serve(async (req) => {
  const expected = Deno.env.get("DISPATCH_SECRET");
  if (!expected || req.headers.get("x-dispatch-secret") !== expected) {
    return new Response("unauthorized", { status: 401 });
  }
  if (!Deno.env.get("RESEND_API_KEY") || !Deno.env.get("REPORT_FROM")) {
    return Response.json({ ok: false, error: "Faltan RESEND_API_KEY o REPORT_FROM" }, { status: 500 });
  }

  const url = new URL(req.url);
  const onlyTo = url.searchParams.get("solo"); // prueba: ?solo=mail@ejemplo.com
  const appUrl = Deno.env.get("APP_URL") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data: orgs, error } = await supabase.from("organizations").select("id, name, currency, settings");
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const sent: string[] = [];
  const failed: { to: string; error: string }[] = [];

  for (const org of orgs ?? []) {
    if (org.settings?.weekly_email === false) continue;

    const [{ data: report, error: rErr }, { data: recipients, error: pErr }] = await Promise.all([
      supabase.rpc("weekly_report", { p_org: org.id }),
      supabase.rpc("report_recipients", { p_org: org.id }),
    ]);
    if (rErr || pErr || !report) {
      failed.push({ to: org.name, error: rErr?.message ?? pErr?.message ?? "sin datos" });
      continue;
    }

    const r = report as Report;
    const brandHtml = brandEmail(r, org.currency, appUrl, org.name);
    const sentToBrand = new Set<string>();

    for (const rec of (recipients ?? []) as Recipient[]) {
      if (onlyTo && rec.email !== onlyTo) continue;
      try {
        if (rec.role === "network_owner" || rec.role === "network_admin") {
          if (sentToBrand.has(rec.email)) continue;
          sentToBrand.add(rec.email);
          await send(rec.email, `${org.name} · resumen semanal de la marca`, brandHtml);
        } else {
          const b = r.branches.find((x) => x.branch_id === rec.branch_id);
          if (!b) continue;
          await send(rec.email, `${org.name} ${b.branch} · resumen semanal`, branchEmail(b, r, org.currency, appUrl, org.name));
        }
        sent.push(rec.email);
        await new Promise((r) => setTimeout(r, 600)); // límite de Resend: 2 mails por segundo
      } catch (err) {
        failed.push({ to: rec.email, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  return Response.json({ ok: failed.length === 0, sent, failed });
});

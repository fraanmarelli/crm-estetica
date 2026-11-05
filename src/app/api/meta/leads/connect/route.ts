import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { canManageBranch, getContext } from "@/lib/context";
import { META_GRAPH_VERSION } from "@/lib/meta";
import { LEAD_SCOPES, META_LEADS_COOKIE, leadsConfigured, leadsRedirectUri } from "@/lib/meta-leads";

// Conectar la página de Facebook de una sucursal para recibir sus leads
export async function GET(request: NextRequest) {
  const back = (msg: string) => NextResponse.redirect(new URL(`/leads?error=${encodeURIComponent(msg)}`, request.url));
  if (!leadsConfigured()) return back("La conexión con Meta todavía no está configurada en el servidor.");

  const ctx = await getContext();
  const branchId = request.nextUrl.searchParams.get("branch") ?? "";
  if (!ctx || !ctx.branches.some((b) => b.id === branchId) || !canManageBranch(ctx, branchId)) {
    return back("Solo el franquiciado o la marca pueden conectar la página.");
  }

  const state = randomBytes(24).toString("hex");
  const dialog = new URL(`https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`);
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID!,
    redirect_uri: leadsRedirectUri(request.nextUrl.origin),
    state,
    response_type: "code",
  });
  // Facebook Login for Business: una configuración con los permisos de leads
  if (process.env.META_LEADS_CONFIG_ID) params.set("config_id", process.env.META_LEADS_CONFIG_ID);
  else params.set("scope", LEAD_SCOPES.join(","));
  dialog.search = params.toString();

  const response = NextResponse.redirect(dialog);
  response.cookies.set(META_LEADS_COOKIE, JSON.stringify({ state, branchId }), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return response;
}

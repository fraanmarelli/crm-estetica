import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { canManageBranch, getContext } from "@/lib/context";
import { META_GRAPH_VERSION, META_OAUTH_COOKIE, metaConfigured, metaRedirectUri } from "@/lib/meta";

export async function GET(request: NextRequest) {
  const back = (msg: string) =>
    NextResponse.redirect(new URL(`/marketing?error=${encodeURIComponent(msg)}`, request.url));

  if (!metaConfigured()) return back("La conexión con Meta todavía no está configurada en el servidor.");

  const ctx = await getContext();
  const branchId = request.nextUrl.searchParams.get("branch") ?? "";
  if (!ctx || !ctx.branches.some((b) => b.id === branchId) || !canManageBranch(ctx, branchId)) {
    return back("No tenés permiso para conectar la publicidad de esta sucursal.");
  }

  const state = randomBytes(24).toString("hex");
  const dialog = new URL(`https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`);
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID!,
    redirect_uri: metaRedirectUri(request.nextUrl.origin),
    state,
    response_type: "code",
  });
  // Apps tipo "Business" usan Facebook Login for Business: una configuración con ads_read
  if (process.env.META_CONFIG_ID) params.set("config_id", process.env.META_CONFIG_ID);
  else params.set("scope", "ads_read");
  dialog.search = params.toString();

  const response = NextResponse.redirect(dialog);
  response.cookies.set(META_OAUTH_COOKIE, JSON.stringify({ state, branchId }), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return response;
}

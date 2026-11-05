import { NextResponse, type NextRequest } from "next/server";
import { canManageBranch, getContext } from "@/lib/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeCodeForToken } from "@/lib/meta";
import { META_LEADS_COOKIE, leadsRedirectUri, listPages } from "@/lib/meta-leads";

export async function GET(request: NextRequest) {
  const finish = (path: string) => {
    const res = NextResponse.redirect(new URL(path, request.url));
    res.cookies.delete(META_LEADS_COOKIE);
    return res;
  };
  const fail = (msg: string) => finish(`/leads?error=${encodeURIComponent(msg)}`);

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return fail("Se canceló la conexión con Facebook.");

  let saved: { state?: string; branchId?: string } = {};
  try {
    saved = JSON.parse(request.cookies.get(META_LEADS_COOKIE)?.value ?? "{}");
  } catch {
    saved = {};
  }
  const code = params.get("code");
  if (!code || !saved.state || saved.state !== params.get("state") || !saved.branchId) {
    return fail("La conexión venció o no es válida. Volvé a intentarlo.");
  }

  // Permiso verificado en código antes de usar el service role
  const ctx = await getContext();
  if (!ctx || !ctx.branches.some((b) => b.id === saved.branchId) || !canManageBranch(ctx, saved.branchId)) {
    return fail("Solo el franquiciado o la marca pueden conectar la página.");
  }

  try {
    const { accessToken } = await exchangeCodeForToken(code, leadsRedirectUri(request.nextUrl.origin));
    const pages = await listPages(accessToken);
    if (pages.length === 0) return fail("Ese usuario de Facebook no administra ninguna página.");

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("lead_oauth_pending")
      .insert({
        user_id: ctx.userId,
        organization_id: ctx.org.id,
        branch_id: saved.branchId,
        pages: pages.map((p) => ({ id: p.id, name: p.name, access_token: p.access_token })),
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return finish(`/leads/conectar?pending=${data.id}`);
  } catch (err) {
    return fail(`Meta respondió: ${err instanceof Error ? err.message : "error desconocido"}`);
  }
}

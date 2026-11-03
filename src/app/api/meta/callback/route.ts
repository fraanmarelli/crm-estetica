import { NextResponse, type NextRequest } from "next/server";
import { canManageBranch, getContext } from "@/lib/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { META_OAUTH_COOKIE, exchangeCodeForToken, listAdAccounts, metaRedirectUri } from "@/lib/meta";

export async function GET(request: NextRequest) {
  const finish = (path: string) => {
    const res = NextResponse.redirect(new URL(path, request.url));
    res.cookies.delete(META_OAUTH_COOKIE);
    return res;
  };
  const fail = (msg: string) => finish(`/marketing?error=${encodeURIComponent(msg)}`);

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return fail("Se canceló la conexión con Facebook.");

  let saved: { state?: string; branchId?: string } = {};
  try {
    saved = JSON.parse(request.cookies.get(META_OAUTH_COOKIE)?.value ?? "{}");
  } catch {
    saved = {};
  }
  const code = params.get("code");
  if (!code || !saved.state || saved.state !== params.get("state") || !saved.branchId) {
    return fail("La conexión venció o no es válida. Volvé a intentarlo.");
  }

  const ctx = await getContext();
  if (!ctx || !canManageBranch(ctx, saved.branchId) || !ctx.branches.some((b) => b.id === saved.branchId)) {
    return fail("No tenés permiso para conectar la publicidad de esta sucursal.");
  }

  try {
    const { accessToken, expiresAt } = await exchangeCodeForToken(code, metaRedirectUri(request.nextUrl.origin));
    const accounts = (await listAdAccounts(accessToken)).map((a) => ({
      account_id: a.account_id,
      name: a.name,
      currency: a.currency,
      active: a.account_status === 1,
    }));
    if (accounts.length === 0) {
      return fail("Ese usuario de Facebook no administra ninguna cuenta publicitaria.");
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("ad_oauth_pending")
      .insert({
        user_id: ctx.userId,
        organization_id: ctx.org.id,
        branch_id: saved.branchId,
        access_token: accessToken,
        token_expires_at: expiresAt,
        accounts,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    return finish(`/marketing/conectar?pending=${data.id}`);
  } catch (err) {
    return fail(`Meta respondió: ${err instanceof Error ? err.message : "error desconocido"}`);
  }
}

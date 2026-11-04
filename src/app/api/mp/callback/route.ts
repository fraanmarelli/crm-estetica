import { NextResponse, type NextRequest } from "next/server";
import { canManageBranch, getContext } from "@/lib/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { MP_OAUTH_COOKIE, exchangeMpCode, mpUser } from "@/lib/mercadopago";

export async function GET(request: NextRequest) {
  const finish = (query: string) => {
    const res = NextResponse.redirect(new URL(`/ajustes?${query}#mp`, request.url));
    res.cookies.delete(MP_OAUTH_COOKIE);
    return res;
  };
  const fail = (msg: string) => finish(`mp_error=${encodeURIComponent(msg)}`);

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return fail("Se canceló la conexión con Mercado Pago.");

  let saved: { state?: string; verifier?: string; accountId?: string; branchId?: string } = {};
  try {
    saved = JSON.parse(request.cookies.get(MP_OAUTH_COOKIE)?.value ?? "{}");
  } catch {
    saved = {};
  }
  const code = params.get("code");
  if (!code || !saved.state || saved.state !== params.get("state") || !saved.verifier || !saved.accountId || !saved.branchId) {
    return fail("La conexión venció o no es válida. Volvé a intentarlo.");
  }

  // Se vuelve a verificar el permiso antes de usar el service role
  const ctx = await getContext();
  if (!ctx || !ctx.branches.some((b) => b.id === saved.branchId) || !canManageBranch(ctx, saved.branchId)) {
    return fail("No tenés permiso para conectar esta cuenta.");
  }

  try {
    const token = await exchangeMpCode(code, saved.verifier, request.nextUrl.origin);
    const user = await mpUser(token.accessToken);
    const admin = createAdminClient();

    const { data: account } = await admin
      .from("payment_accounts")
      .select("id, organization_id, branch_id")
      .eq("id", saved.accountId)
      .eq("branch_id", saved.branchId)
      .single();
    if (!account) return fail("No se encontró la cuenta de cobro.");

    const { data: conn, error } = await admin
      .from("mp_connections")
      .upsert(
        {
          organization_id: account.organization_id,
          branch_id: account.branch_id,
          account_id: account.id,
          mp_user_id: user.id,
          mp_nickname: user.nickname,
          connected_by: ctx.userId,
          token_expires_at: token.expiresAt,
          last_error: null,
          is_active: true,
        },
        { onConflict: "account_id" },
      )
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const { error: secretError } = await admin.from("mp_connection_secrets").upsert({
      connection_id: conn.id,
      access_token: token.accessToken,
      refresh_token: token.refreshToken,
      updated_at: new Date().toISOString(),
    });
    if (secretError) throw new Error(secretError.message);

    return finish("mp=ok");
  } catch (err) {
    return fail(`Mercado Pago respondió: ${err instanceof Error ? err.message : "error desconocido"}`);
  }
}

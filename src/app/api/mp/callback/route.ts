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

    // La misma cuenta de MP no puede quedar en dos cuentas de cobro de la sucursal: pasa cuando el
    // navegador ya tenía abierta otra cuenta de MP (MP no vuelve a preguntar y conecta esa).
    const { data: taken } = await admin
      .from("mp_connections")
      .select("account_id")
      .eq("branch_id", account.branch_id)
      .eq("mp_user_id", user.id)
      .neq("account_id", account.id)
      .maybeSingle();
    // Solo códigos e ids en la dirección: el nombre de la cuenta de MP lo arma la página desde la base
    if (taken) return finish(`mp_error=repetida&cuenta=${taken.account_id}`);

    const { data: conn, error } = await admin
      .from("mp_connections")
      .upsert(
        {
          organization_id: account.organization_id,
          branch_id: account.branch_id,
          account_id: account.id,
          mp_user_id: user.id,
          mp_nickname: user.nickname,
          mp_name: user.name,
          mp_email: user.email,
          connected_by: ctx.userId,
          token_expires_at: token.expiresAt,
          last_error: null,
          is_active: true,
        },
        { onConflict: "account_id" },
      )
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") {
        return finish("mp_error=repetida");
      }
      throw new Error(error.message);
    }

    const { error: secretError } = await admin.from("mp_connection_secrets").upsert({
      connection_id: conn.id,
      access_token: token.accessToken,
      refresh_token: token.refreshToken,
      updated_at: new Date().toISOString(),
    });
    if (secretError) throw new Error(secretError.message);

    // El id de la cuenta de cobro (no datos de la persona) para resaltar cuál se acaba de conectar
    return finish(`mp=ok&cuenta=${account.id}`);
  } catch (err) {
    return fail(`Mercado Pago respondió: ${err instanceof Error ? err.message : "error desconocido"}`);
  }
}

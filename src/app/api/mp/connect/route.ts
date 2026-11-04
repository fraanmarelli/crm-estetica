import { NextResponse, type NextRequest } from "next/server";
import { canManageBranch, getContext } from "@/lib/context";
import { createClient } from "@/lib/supabase/server";
import { MP_OAUTH_COOKIE, mpConfigured, startMpOAuth } from "@/lib/mercadopago";

// Inicia la conexión de una cuenta de cobro con su cuenta de Mercado Pago (franquiciado o marca)
export async function GET(request: NextRequest) {
  const back = (msg: string) => NextResponse.redirect(new URL(`/ajustes?mp_error=${encodeURIComponent(msg)}#mp`, request.url));

  if (!mpConfigured()) return back("La conexión con Mercado Pago todavía no está configurada en el servidor.");

  const ctx = await getContext();
  const accountId = request.nextUrl.searchParams.get("account") ?? "";
  if (!ctx) return back("Iniciá sesión de nuevo.");

  const supabase = await createClient();
  const { data: account } = await supabase
    .from("payment_accounts")
    .select("id, branch_id, currency")
    .eq("id", accountId)
    .maybeSingle();
  if (!account || !canManageBranch(ctx, account.branch_id)) {
    return back("No tenés permiso para conectar esta cuenta.");
  }
  if (account.currency !== "ARS") return back("Solo se pueden verificar cuentas en pesos.");

  const { url, state, verifier } = startMpOAuth(request.nextUrl.origin);
  const response = NextResponse.redirect(url);
  response.cookies.set(MP_OAUTH_COOKIE, JSON.stringify({ state, verifier, accountId, branchId: account.branch_id }), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return response;
}

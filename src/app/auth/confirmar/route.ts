import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Llega desde el link del mail de Supabase (recuperar contraseña). Valida el link, deja la sesión iniciada
// y manda a elegir la contraseña nueva. Acepta las dos formas de link:
// - ?token_hash=...&type=recovery (sirve aunque el mail se abra en otro dispositivo)
// - ?code=... (el link de siempre de Supabase; solo en el mismo navegador donde se pidió)
const ALLOWED_NEXT = new Set(["/nueva-contrasena", "/"]);

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = ALLOWED_NEXT.has(params.get("next") ?? "") ? (params.get("next") as string) : "/nueva-contrasena";
  const supabase = await createClient();

  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const code = params.get("code");

  let ok = false;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    ok = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  if (!ok) {
    return NextResponse.redirect(new URL("/recuperar?vencido=1", request.url));
  }
  return NextResponse.redirect(new URL(next, request.url));
}

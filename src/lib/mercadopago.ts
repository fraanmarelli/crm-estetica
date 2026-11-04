import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { appUrl } from "@/lib/meta";

// Conexión de cuentas de Mercado Pago por OAuth (solo lectura) para verificar transferencias.
export const MP_OAUTH_COOKIE = "crm_mp_oauth";
const MP_API = "https://api.mercadopago.com";

export function mpConfigured(): boolean {
  return Boolean(process.env.MP_CLIENT_ID && process.env.MP_CLIENT_SECRET && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function mpRedirectUri(requestOrigin: string): string {
  return `${appUrl(requestOrigin)}/api/mp/callback`;
}

const b64url = (b: Buffer) => b.toString("base64url");

// PKCE (S256): el verificador queda en una cookie del servidor, el desafío viaja a MP
export function startMpOAuth(requestOrigin: string) {
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const url = new URL("https://auth.mercadopago.com.ar/authorization");
  url.search = new URLSearchParams({
    client_id: process.env.MP_CLIENT_ID!,
    response_type: "code",
    platform_id: "mp",
    state,
    redirect_uri: mpRedirectUri(requestOrigin),
    code_challenge: challenge,
    code_challenge_method: "S256",
    // Los permisos (lectura + acceso offline) se definen en la aplicación de Mercado Pago, no en la URL
  }).toString();
  return { url, state, verifier };
}

export async function exchangeMpCode(code: string, verifier: string, requestOrigin: string) {
  const res = await fetch(`${MP_API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: process.env.MP_CLIENT_ID,
      client_secret: process.env.MP_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: mpRedirectUri(requestOrigin),
      code_verifier: verifier,
    }),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.message ?? data.error ?? `Mercado Pago respondió ${res.status}`);
  }
  return {
    accessToken: data.access_token as string,
    refreshToken: (data.refresh_token as string | undefined) ?? null,
    expiresAt: data.expires_in ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString() : null,
    userId: data.user_id != null ? String(data.user_id) : null,
  };
}

export async function mpUser(accessToken: string): Promise<{ id: string; nickname: string | null }> {
  const res = await fetch(`${MP_API}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Mercado Pago respondió ${res.status} al leer la cuenta`);
  const data = await res.json();
  return { id: String(data.id), nickname: data.nickname ?? data.email ?? null };
}

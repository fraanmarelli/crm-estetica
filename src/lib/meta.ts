import "server-only";

export const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v23.0";
export const META_OAUTH_COOKIE = "crm_meta_oauth";

export function metaConfigured(): boolean {
  return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function appUrl(requestOrigin: string): string {
  return (process.env.APP_URL ?? requestOrigin).replace(/\/$/, "");
}

export function metaRedirectUri(requestOrigin: string): string {
  return `${appUrl(requestOrigin)}/api/meta/callback`;
}

async function graph<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json();
  if (!res.ok || body.error) {
    throw new Error(body.error?.message ?? `Meta respondió ${res.status}`);
  }
  return body as T;
}

export async function exchangeCodeForToken(code: string, redirectUri: string) {
  const short = await graph<{ access_token: string }>("oauth/access_token", {
    client_id: process.env.META_APP_ID!,
    client_secret: process.env.META_APP_SECRET!,
    redirect_uri: redirectUri,
    code,
  });
  // Token de larga duración (~60 días)
  const long = await graph<{ access_token: string; expires_in?: number }>("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: process.env.META_APP_ID!,
    client_secret: process.env.META_APP_SECRET!,
    fb_exchange_token: short.access_token,
  });
  return {
    accessToken: long.access_token,
    expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null,
  };
}

export type MetaAdAccount = { account_id: string; name: string; currency: string; account_status: number };

export async function listAdAccounts(accessToken: string): Promise<MetaAdAccount[]> {
  const body = await graph<{ data: MetaAdAccount[] }>("me/adaccounts", {
    fields: "account_id,name,currency,account_status",
    limit: "200",
    access_token: accessToken,
  });
  return body.data ?? [];
}

// Pide una sincronización inmediata (no espera el resultado)
export async function triggerMetaSync(): Promise<void> {
  const secret = process.env.DISPATCH_SECRET;
  if (!secret) return;
  try {
    await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/meta-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-dispatch-secret": secret },
      body: "{}",
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    // Si tarda, sigue corriendo del lado de Supabase; si falla, la sincronización diaria lo trae.
  }
}

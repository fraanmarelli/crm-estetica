import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Tus datos", robots: { index: false, follow: false } };

// Página pública de registro de pacientes (link fijo de la sucursal)
export default async function RegisterPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const { data } = await admin
    .from("branches")
    .select("name, organization:organizations(name, settings)")
    .eq("intake_token", token)
    .eq("is_active", true)
    .maybeSingle();

  const branch = data as unknown as {
    name: string;
    organization: { name: string; settings: { brand?: { logo_url?: string } } } | null;
  } | null;
  const orgName = branch?.organization?.name ?? "la clínica";
  const logo = branch?.organization?.settings?.brand?.logo_url;

  return (
    <main
      className="mx-auto min-h-screen max-w-xl space-y-6 pb-12 pt-8"
      style={{
        paddingLeft: "max(16px, env(safe-area-inset-left, 0px))",
        paddingRight: "max(16px, env(safe-area-inset-right, 0px))",
      }}
    >
      <header className="flex flex-col items-center gap-3 rounded-2xl bg-chrome px-4 py-6 text-center text-chrome-ink">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt={orgName} className="h-auto w-32" />
        ) : (
          <span className="gold-text font-display text-3xl">{orgName}</span>
        )}
        {branch && <p className="text-sm text-chrome-muted">{branch.name}</p>}
      </header>

      {branch ? (
        <>
          <div>
            <h1>Tus datos</h1>
            <p className="page-sub">Completalos una sola vez. Los usamos para tu atención y tus turnos.</p>
          </div>
          <RegisterForm token={token} clinic={`${orgName} ${branch.name}`} />
        </>
      ) : (
        <div className="card space-y-2 text-center">
          <h1>Este link ya no funciona</h1>
          <p className="text-muted">Pedile el nuevo a recepción.</p>
        </div>
      )}
    </main>
  );
}

import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { IntakeForm } from "./intake-form";

export const metadata: Metadata = { title: "Tus datos", robots: { index: false, follow: false } };

// Página pública: solo muestra el formulario si el link es válido
export default async function PublicIntakePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const { data } = await admin
    .from("patient_intakes")
    .select("expires_at, used_at, organization:organizations(name, settings), branch:branches(name)")
    .eq("token", token)
    .maybeSingle();

  const intake = data as unknown as {
    expires_at: string;
    used_at: string | null;
    organization: { name: string; settings: { brand?: { logo_url?: string } } } | null;
    branch: { name: string } | null;
  } | null;

  const valid = intake && !intake.used_at && new Date(intake.expires_at).getTime() > Date.now();
  const orgName = intake?.organization?.name ?? "la clínica";
  const logo = intake?.organization?.settings?.brand?.logo_url;
  const clinic = `${orgName}${intake?.branch ? ` ${intake.branch.name}` : ""}`;

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
        <p className="text-sm text-chrome-muted">{intake?.branch?.name ?? ""}</p>
      </header>

      {valid ? (
        <>
          <div>
            <h1>Tus datos</h1>
            <p className="page-sub">Completalos una sola vez. Los usamos para tu atención y tus turnos.</p>
          </div>
          <IntakeForm token={token} clinic={clinic} />
        </>
      ) : (
        <div className="card space-y-2 text-center">
          <h1>Este link no está disponible</h1>
          <p className="text-muted">Ya se usó o venció. Pedile uno nuevo a recepción.</p>
        </div>
      )}
    </main>
  );
}

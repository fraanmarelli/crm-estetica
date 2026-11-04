import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { IntakeForm } from "./intake-form";

export const metadata: Metadata = { title: "Tu ficha", robots: { index: false, follow: false } };

// Página pública: completar la ficha de una paciente con su link personal (un uso, 7 días)
export default async function IntakePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ local?: string }>;
}) {
  const { token } = await params;
  const onClinicDevice = (await searchParams).local === "1";
  const admin = createAdminClient();
  const { data } = await admin
    .from("patient_intakes")
    .select(
      "patient:patients(first_name, last_name, consent_data_at), branch:branches(name, organization:organizations(name, settings))",
    )
    .eq("token", token)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  const intake = data as unknown as {
    patient: { first_name: string; last_name: string | null; consent_data_at: string | null } | null;
    branch: { name: string; organization: { name: string; settings: { brand?: { logo_url?: string } } } | null } | null;
  } | null;
  const orgName = intake?.branch?.organization?.name ?? "la clínica";
  const logo = intake?.branch?.organization?.settings?.brand?.logo_url;
  const valid = Boolean(intake?.patient && !intake.patient.consent_data_at);

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
        {intake?.branch && <p className="text-sm text-chrome-muted">{intake.branch.name}</p>}
      </header>

      {valid && intake?.patient && intake.branch ? (
        <>
          <div>
            <h1>Hola, {intake.patient.first_name}</h1>
            <p className="page-sub">Completá tus datos una sola vez. Los usamos para tu atención y tus turnos.</p>
          </div>
          <IntakeForm
            token={token}
            clinic={`${orgName} ${intake.branch.name}`}
            firstName={intake.patient.first_name}
            lastName={intake.patient.last_name ?? ""}
            onClinicDevice={onClinicDevice}
          />
        </>
      ) : (
        <div className="card space-y-2 text-center">
          <h1>Este link ya no funciona</h1>
          <p className="text-muted">Ya se usó o venció. Si te falta completar tus datos, pedile uno nuevo a recepción.</p>
        </div>
      )}
    </main>
  );
}

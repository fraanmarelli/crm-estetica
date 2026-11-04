import Link from "next/link";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { requireBranchContext } from "@/lib/context";
import { fmtDate, fullName, whatsappLink } from "@/lib/format";
import type { Patient } from "@/lib/types";
import { createIntakeLink } from "../../../actions";
import { PatientEditForm } from "../patient-edit-form";
import { AutoRefresh, CopyLink } from "../../registro/client-bits";

// Completar la ficha de una paciente cargada rápido: ella con su QR/link, o recepción a mano
export default async function CompleteIntakePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ volver?: string }>;
}) {
  const ctx = await requireBranchContext();
  const { id } = await params;
  const { volver } = await searchParams;
  const back = volver && volver.startsWith("/") && !volver.startsWith("//") ? volver : `/pacientes/${id}`;
  const supabase = await createClient();

  const [{ data }, { data: intake }] = await Promise.all([
    supabase.from("patients").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("patient_intakes")
      .select("token, expires_at")
      .eq("patient_id", id)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const patient = data as Patient | null;
  if (!patient) return <p className="alert-error">No se encontró la paciente.</p>;
  const name = fullName(patient);

  if (patient.consent_data_at) {
    return (
      <div className="card mx-auto max-w-md space-y-3 text-center">
        <h1>La ficha de {patient.first_name} está completa</h1>
        <p className="text-sm text-muted">Ya tiene sus datos y el consentimiento registrados.</p>
        <div className="flex justify-center gap-2">
          <Link href={back} className="btn btn-primary">Seguir</Link>
          <Link href={`/pacientes/${patient.id}`} className="btn">Ver ficha</Link>
        </div>
      </div>
    );
  }

  let qr: string | null = null;
  let url: string | null = null;
  if (intake) {
    const h = await headers();
    const origin = (process.env.APP_URL ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`).replace(/\/$/, "");
    url = `${origin}/ficha/${intake.token}`;
    qr = await QRCode.toString(url, { type: "svg", margin: 1, width: 220, color: { dark: "#1f1b16", light: "#ffffff" } });
  }
  const whatsapp =
    url && patient.phone
      ? whatsappLink(
          patient.phone,
          `Hola ${patient.first_name}! Para agilizar tu turno en ${ctx.org.name} ${ctx.currentBranch.name}, si querés podés completar tus datos acá: ${url}`,
        )
      : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {intake && <AutoRefresh />}
      <div className="page-head">
        <div>
          <h1>Completar ficha · {name}</h1>
          <p className="page-sub">Se cargó rápido para darle el turno. Falta su DNI, sus datos y el consentimiento.</p>
        </div>
      </div>

      <section className="card space-y-4">
        <div>
          <h2>Que la complete ella</h2>
          <p className="text-sm text-muted">
            Con el QR desde su celular, o pasale la tablet o el celular del local. Apenas termina, esta pantalla se
            actualiza sola.
          </p>
        </div>
        {intake && qr && url ? (
          <div className="grid gap-5 sm:grid-cols-[220px_1fr] sm:items-center">
            <div className="mx-auto w-[220px] rounded-xl bg-white p-2" dangerouslySetInnerHTML={{ __html: qr }} />
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-2">
                <a href={`${url}?local=1`} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                  Abrir en este dispositivo
                </a>
                {whatsapp && (
                  <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="btn">
                    Mandar por WhatsApp
                  </a>
                )}
                <CopyLink url={url} />
              </div>
              <p className="text-xs text-muted">
                El link es solo de {patient.first_name}, sirve una vez y vence el {fmtDate(intake.expires_at)}. No
                muestra ni deja cambiar nada más.
              </p>
            </div>
          </div>
        ) : (
          <form action={createIntakeLink}>
            <input type="hidden" name="patient_id" value={patient.id} />
            <button className="btn btn-primary">Mostrar QR y link</button>
          </form>
        )}
      </section>

      <section id="yo" className="card scroll-mt-6 space-y-4">
        <div>
          <h2>La completo yo</h2>
          <p className="text-sm text-muted">Si te dicta los datos o prefiere que la cargues vos.</p>
        </div>
        <PatientEditForm patient={patient} completing back={back} />
      </section>
    </div>
  );
}

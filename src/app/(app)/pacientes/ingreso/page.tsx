import Link from "next/link";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { requireBranchContext } from "@/lib/context";
import { fullName } from "@/lib/format";
import { SubmitButton } from "@/components/submit-button";
import { createIntake } from "./actions";
import { IntakeWaiting } from "./waiting";
import { CopyLink } from "./copy-link";

type Intake = {
  id: string;
  token: string;
  expires_at: string;
  used_at: string | null;
  already_existed: boolean;
  patient: { id: string; first_name: string; last_name: string | null } | null;
};

export default async function IntakePage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; turno?: string; fecha?: string; vista?: string }>;
}) {
  const ctx = await requireBranchContext();
  const sp = await searchParams;
  const forTurn = sp.turno === "1";
  const turnParams = `${sp.fecha ? `&fecha=${sp.fecha}` : ""}${sp.vista === "semana" ? "&vista=semana" : ""}`;

  // Paso 1: generar la ficha
  if (!sp.id) {
    return (
      <div className="mx-auto max-w-lg space-y-6">
        <div>
          <h1>Ficha de ingreso</h1>
          <p className="page-sub">
            La paciente carga sus propios datos desde un celular: el de la clínica o el suyo escaneando un código QR.
          </p>
        </div>
        <form action={createIntake} className="card space-y-4">
          {forTurn && <input type="hidden" name="turno" value="1" />}
          {sp.fecha && <input type="hidden" name="fecha" value={sp.fecha} />}
          {sp.vista && <input type="hidden" name="vista" value={sp.vista} />}
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            <li>El link sirve para una sola paciente y vence en 60 minutos.</li>
            <li>La paciente no ve nada del CRM: solo el formulario de sus datos.</li>
            <li>Si ya estaba registrada (mismo celular o DNI), no se duplica.</li>
          </ul>
          <SubmitButton pendingText="Generando...">Generar ficha</SubmitButton>
        </form>
        <p className="text-sm text-muted">
          ¿Preferís cargarla vos?{" "}
          <Link href={`/pacientes/nuevo${forTurn ? `?turno=1${turnParams}` : ""}`} className="link">
            Cargar datos a mano
          </Link>
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("patient_intakes")
    .select("id, token, expires_at, used_at, already_existed, patient:patients(id, first_name, last_name)")
    .eq("id", sp.id)
    .maybeSingle();
  const intake = data as unknown as Intake | null;

  if (!intake) {
    return <p className="alert-error">No se encontró la ficha.</p>;
  }

  // Paso 3: la paciente ya la envió
  if (intake.used_at) {
    const p = intake.patient;
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <h1>{intake.already_existed ? "Ya estaba registrada" : "Ficha completa"}</h1>
        <div className="card space-y-4">
          <p className="text-sm">
            {p ? <b>{fullName(p)}</b> : "La paciente"}{" "}
            {intake.already_existed
              ? "ya tenía ficha en la red con ese celular o DNI. No se cambiaron sus datos."
              : "quedó registrada en la sucursal."}
          </p>
          {p && (
            <div className="flex flex-wrap gap-2">
              <Link href={`/turnos/nuevo?paciente=${p.id}${turnParams}`} className="btn btn-primary">
                Darle un turno
              </Link>
              <Link href={`/pacientes/${p.id}`} className="btn">Ver ficha</Link>
            </div>
          )}
        </div>
      </div>
    );
  }

  const expired = new Date(intake.expires_at).getTime() < Date.now();
  const h = await headers();
  const origin = (process.env.APP_URL ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`).replace(/\/$/, "");
  const url = `${origin}/ingreso/${intake.token}`;
  const qr = await QRCode.toString(url, { type: "svg", margin: 1, width: 240, color: { dark: "#1f1b16", light: "#ffffff" } });

  // Paso 2: mostrar QR / link y esperar
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1>Ficha de ingreso</h1>
        <p className="page-sub">{ctx.currentBranch.name}</p>
      </div>

      {expired ? (
        <div className="card space-y-3">
          <p className="text-sm">Este link venció.</p>
          <form action={createIntake}>
            {forTurn && <input type="hidden" name="turno" value="1" />}
            {sp.fecha && <input type="hidden" name="fecha" value={sp.fecha} />}
            {sp.vista && <input type="hidden" name="vista" value={sp.vista} />}
            <SubmitButton pendingText="Generando...">Generar uno nuevo</SubmitButton>
          </form>
        </div>
      ) : (
        <div className="card space-y-5">
          <div className="grid gap-5 sm:grid-cols-[240px_1fr] sm:items-center">
            <div className="mx-auto w-[240px] rounded-xl border border-line bg-white p-2" dangerouslySetInnerHTML={{ __html: qr }} />
            <div className="space-y-3 text-sm">
              <p>
                <b>Con su celular:</b> que escanee el código con la cámara.
              </p>
              <p>
                <b>Con el de la clínica:</b> abrí el link y pasale el celular.
              </p>
              <div className="flex flex-wrap gap-2">
                <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                  Abrir formulario
                </a>
                <CopyLink url={url} />
              </div>
            </div>
          </div>
          <IntakeWaiting />
        </div>
      )}
    </div>
  );
}

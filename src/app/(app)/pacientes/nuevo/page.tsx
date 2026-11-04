import Link from "next/link";
import { requireBranchContext } from "@/lib/context";
import { NewPatientForm } from "./patient-form";

export default async function NewPatientPage({
  searchParams,
}: {
  searchParams: Promise<{ turno?: string; fecha?: string; vista?: string }>;
}) {
  const ctx = await requireBranchContext();
  const sp = await searchParams;
  // Si viene de "Nuevo turno", al guardar sigue directo a darle el turno
  const next = {
    turno: sp.turno === "1" ? "1" : "",
    fecha: sp.fecha && /^\d{4}-\d{2}-\d{2}$/.test(sp.fecha) ? sp.fecha : "",
    vista: sp.vista === "semana" ? "semana" : "",
  };
  const query = new URLSearchParams(Object.entries(next).filter(([, v]) => v)).toString();

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="page-head">
        <div>
          <h1>Nueva paciente</h1>
          <p className="page-sub">
            Queda registrada en {ctx.currentBranch.name}.{next.turno ? " Al guardar seguís con su turno." : ""}
          </p>
        </div>
        <Link href={`/pacientes/ingreso${query ? `?${query}` : ""}`} className="btn">
          Que la complete ella
        </Link>
      </div>
      <NewPatientForm next={next} />
    </div>
  );
}

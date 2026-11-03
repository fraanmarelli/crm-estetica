import { requireBranchContext } from "@/lib/context";
import { NewPatientForm } from "./patient-form";

export default async function NewPatientPage() {
  const ctx = await requireBranchContext();
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1>Nueva paciente</h1>
        <p className="text-sm text-muted">Queda registrada en {ctx.currentBranch.name}.</p>
      </div>
      <NewPatientForm />
    </div>
  );
}

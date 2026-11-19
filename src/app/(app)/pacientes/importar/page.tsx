import { createClient } from "@/lib/supabase/server";
import { requireManagerContext } from "@/lib/context";
import { todayISO } from "@/lib/format";
import { BackLink } from "@/components/back-link";
import { ImportPanel } from "./import-panel";

// Pacientes → Importar historial (franquiciado y marca): la planilla de la sucursal, las veces que haga falta
export default async function ImportPage() {
  const ctx = await requireManagerContext();
  const supabase = await createClient();
  const [{ data: treatments }, { data: accounts }] = await Promise.all([
    supabase.from("treatments").select("name").eq("organization_id", ctx.org.id).eq("is_active", true),
    supabase.from("payment_accounts").select("name, currency").eq("branch_id", ctx.currentBranch.id),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <BackLink fallback="/pacientes" label="Pacientes" />
      <div>
        <h1>Importar historial</h1>
        <p className="page-sub">
          La planilla de {ctx.currentBranch.name}: cada fila es una visita atendida. Se puede volver a importar cuando
          quieras; solo entra lo nuevo.
        </p>
      </div>
      <ImportPanel
        branchName={ctx.currentBranch.name}
        catalog={((treatments ?? []) as { name: string }[]).map((t) => t.name)}
        accounts={(accounts ?? []) as { name: string; currency: string }[]}
        today={todayISO()}
      />
    </div>
  );
}

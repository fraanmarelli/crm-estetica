import { createClient } from "@/lib/supabase/server";
import { requireNetworkContext } from "@/lib/context";
import { fmtDateTime } from "@/lib/format";
import { toggleIntegration } from "../actions";
import { IntegrationForm } from "./integration-form";

type Integration = {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  config: { url?: string };
  branch: { name: string } | null;
};

type OutboxRow = {
  id: number;
  event_type: string;
  status: "pending" | "sent" | "failed";
  attempts: number;
  last_error: string | null;
  created_at: string;
};

export default async function SettingsPage() {
  const ctx = await requireNetworkContext();
  const supabase = await createClient();

  const [{ data: integrations }, { data: problems }, { count: pending }] = await Promise.all([
    supabase
      .from("integrations")
      .select("id, name, type, is_active, config, branch:branches(name)")
      .eq("organization_id", ctx.org.id)
      .order("created_at"),
    supabase
      .from("event_outbox")
      .select("id, event_type, status, attempts, last_error, created_at")
      .eq("organization_id", ctx.org.id)
      .not("last_error", "is", null)
      .neq("status", "sent")
      .order("id", { ascending: false })
      .limit(20),
    supabase
      .from("event_outbox")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.org.id)
      .eq("status", "pending"),
  ]);

  const list = (integrations ?? []) as unknown as Integration[];
  const errors = (problems ?? []) as OutboxRow[];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1>Ajustes</h1>

      <section className="card space-y-4">
        <div>
          <h2>Planillas de Google conectadas</h2>
          <p className="text-sm text-muted">
            Cada turno realizado (o editado después de realizado) se copia a la planilla en menos de un minuto.
            Eventos en cola ahora: {pending ?? 0}.
          </p>
        </div>

        {list.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {list.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <div>
                  <p className="font-medium">
                    {i.name} <span className="text-muted">· {i.branch?.name ?? "Todas las sucursales"}</span>
                  </p>
                  <p className="max-w-md truncate text-xs text-muted">{i.config.url}</p>
                </div>
                <form action={toggleIntegration}>
                  <input type="hidden" name="id" value={i.id} />
                  <input type="hidden" name="active" value={i.is_active ? "0" : "1"} />
                  <button className={`btn btn-sm ${i.is_active ? "" : "btn-primary"}`}>
                    {i.is_active ? "Pausar" : "Activar"}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        <IntegrationForm branches={ctx.branches} />
      </section>

      <section className="card space-y-3">
        <h2>Errores de sincronización</h2>
        {errors.length === 0 ? (
          <p className="text-sm text-muted">Sin errores.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {errors.map((e) => (
              <li key={e.id} className="rounded-lg bg-subtle p-2">
                <p>
                  <span className={`badge ${e.status === "failed" ? "badge-red" : "badge-amber"}`}>
                    {e.status === "failed" ? "Falló (se dejó de reintentar)" : `Reintentando (${e.attempts})`}
                  </span>{" "}
                  <span className="text-muted">{fmtDateTime(e.created_at)}</span>
                </p>
                <p className="mt-1 break-all text-xs text-muted">{e.last_error}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

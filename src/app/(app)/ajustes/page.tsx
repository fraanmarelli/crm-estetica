import { createClient } from "@/lib/supabase/server";
import { requireManagerContext } from "@/lib/context";
import { fmtDateTime } from "@/lib/format";
import { toggleIntegration } from "../actions";
import { IntegrationForm } from "./integration-form";
import { AccountsForm, ProfessionalsForm } from "./team-forms";

type Integration = {
  id: string;
  name: string;
  type: "google_sheets" | "klaviyo";
  is_active: boolean;
  config: { url?: string; list_id?: string };
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

const TYPE_LABEL = { google_sheets: "Google Sheets", klaviyo: "Klaviyo" };

export default async function SettingsPage() {
  const ctx = await requireManagerContext();
  const supabase = await createClient();

  // RLS: la marca ve todas; el franquiciado, las de su sucursal
  const [{ data: integrations }, { data: problems }, { data: profs }, { data: accounts }] = await Promise.all([
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
    supabase.rpc("professional_list", { p_branch: ctx.currentBranch.id }),
    supabase
      .from("payment_accounts")
      .select("id, name, currency, is_active")
      .eq("branch_id", ctx.currentBranch.id)
      .order("sort_order")
      .order("name"),
  ]);

  const list = (integrations ?? []) as unknown as Integration[];
  const errors = (problems ?? []) as OutboxRow[];

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="page-head">
        <div>
          <h1>Ajustes</h1>
          <p className="page-sub">{ctx.currentBranch.name}: médicos, cuentas de cobro y conexiones</p>
        </div>
      </div>

      <section className="card space-y-4">
        <div>
          <h2>Médicos y comisión</h2>
          <p className="text-sm text-muted">
            La comisión se calcula sola en cada turno: porcentaje sobre lo cobrado. Se puede cambiar a mano en un turno
            puntual. Recepción no ve estos porcentajes.
          </p>
        </div>
        <ProfessionalsForm
          professionals={(profs ?? []) as { id: string; full_name: string; commission_pct: number; is_active: boolean }[]}
        />
      </section>

      <section className="card space-y-4">
        <div>
          <h2>Cuentas de cobro</h2>
          <p className="text-sm text-muted">Las opciones que aparecen al registrar cómo pagó cada paciente.</p>
        </div>
        <AccountsForm
          accounts={(accounts ?? []) as { id: string; name: string; currency: "ARS" | "USD"; is_active: boolean }[]}
        />
      </section>

      <section className="card space-y-4">
        <h2>Conexiones</h2>
        {list.length === 0 ? (
          <p className="text-sm text-muted">Todavía no hay nada conectado.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {list.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {TYPE_LABEL[i.type]}{" "}
                    <span className="font-normal text-muted">· {i.branch?.name ?? "Todas las sucursales"}</span>
                  </p>
                  <p className="max-w-md truncate text-xs text-muted">
                    {i.type === "google_sheets" ? i.config.url : i.config.list_id ? `Lista ${i.config.list_id}` : i.name}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`badge ${i.is_active ? "badge-green" : "badge-gray"}`}>
                    {i.is_active ? "Activa" : "Pausada"}
                  </span>
                  <form action={toggleIntegration}>
                    <input type="hidden" name="id" value={i.id} />
                    <input type="hidden" name="active" value={i.is_active ? "0" : "1"} />
                    <button className="btn btn-sm">{i.is_active ? "Pausar" : "Activar"}</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-4">
        <h2>Conectar</h2>
        <IntegrationForm branches={ctx.branches} isNetwork={ctx.isNetwork} currentBranch={ctx.currentBranch} />
      </section>

      <section className="card space-y-3">
        <h2>Cómo usar Klaviyo para los recordatorios</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>Cada tratamiento realizado llega a Klaviyo como evento «Tratamiento realizado», con el tratamiento y su fecha de vencimiento.</li>
          <li>En Klaviyo creá un flow por tratamiento: disparador «Tratamiento realizado», filtro «tratamiento = Botox», espera de 110 días y el mail.</li>
          <li>Agregá el filtro «no hizo Tratamiento realizado desde que empezó el flow» para no escribirle a quien ya volvió.</li>
          <li>Solo se envían pacientes que aceptaron recibir mails y tienen email cargado.</li>
        </ol>
      </section>

      <section className="card space-y-3">
        <h2>Errores de envío</h2>
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

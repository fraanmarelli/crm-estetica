import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireManagerContext } from "@/lib/context";
import { fmtDateTime, fmtTime } from "@/lib/format";
import { mpConfigured } from "@/lib/mercadopago";
import { toggleIntegration } from "../actions";
import { disconnectMp } from "./actions";
import { IntegrationForm } from "./integration-form";
import { AccountsForm, ProfessionalsForm } from "./team-forms";

type Integration = {
  id: string;
  name: string;
  type: "google_sheets" | "klaviyo" | "google_calendar";
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

const TYPE_LABEL = { google_sheets: "Google Sheets", klaviyo: "Klaviyo", google_calendar: "Google Calendar" };

type MpConnection = {
  id: string;
  account_id: string;
  mp_nickname: string | null;
  last_checked_at: string | null;
  last_error: string | null;
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ mp?: string; mp_error?: string }>;
}) {
  const ctx = await requireManagerContext();
  const sp = await searchParams;
  const supabase = await createClient();

  // RLS: la marca ve todas; el franquiciado, las de su sucursal
  const [{ data: integrations }, { data: problems }, { data: profs }, { data: accounts }, { data: mpData }] = await Promise.all([
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
    supabase
      .from("mp_connections")
      .select("id, account_id, mp_nickname, last_checked_at, last_error")
      .eq("branch_id", ctx.currentBranch.id),
  ]);
  const mpConnections = (mpData ?? []) as MpConnection[];
  const pesoAccounts = ((accounts ?? []) as { id: string; name: string; currency: string; is_active: boolean }[]).filter(
    (a) => a.currency === "ARS" && a.is_active && a.name.toLowerCase() !== "efectivo",
  );

  const list = (integrations ?? []) as unknown as Integration[];
  const errors = (problems ?? []) as OutboxRow[];

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="page-head">
        <div>
          <h1>Ajustes</h1>
          <p className="page-sub">{ctx.currentBranch.name}: médicos, cuentas de cobro y conexiones (Google Calendar, Klaviyo, planilla)</p>
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
          <p className="text-sm text-muted">
            Las opciones que aparecen al registrar cómo pagó cada paciente. El titular de cada cuenta y los topes del
            monotributo se cargan en <Link href="/facturacion" className="link">Facturación</Link>.
          </p>
        </div>
        <AccountsForm
          accounts={(accounts ?? []) as { id: string; name: string; currency: "ARS" | "USD"; is_active: boolean }[]}
        />
      </section>

      <section id="mp" className="card space-y-4">
        <div>
          <h2>Verificar transferencias de Mercado Pago</h2>
          <p className="text-sm text-muted">
            Conectá cada cuenta de Mercado Pago del local. Cuando se carga un cobro o una seña en esa cuenta, el CRM se
            fija solo si la plata llegó: monto exacto y, si la paciente tiene DNI cargado, que la haya mandado ella.
            Tarda uno o dos minutos. Es solo lectura: el CRM no puede mover plata.
          </p>
        </div>
        {sp.mp === "ok" && <p className="alert-ok">Cuenta de Mercado Pago conectada.</p>}
        {sp.mp_error && <p className="alert-error">{sp.mp_error}</p>}
        {!mpConfigured() ? (
          <p className="text-sm text-muted">Falta configurar la aplicación de Mercado Pago en el servidor (ver README).</p>
        ) : (
          <ul className="divide-y divide-line">
            {pesoAccounts.map((a) => {
              const conn = mpConnections.find((c) => c.account_id === a.id);
              return (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold">{a.name}</p>
                    {conn ? (
                      <p className={`text-xs ${conn.last_error ? "text-bad" : "text-muted"}`}>
                        {conn.last_error
                          ? `Error: ${conn.last_error}`
                          : `Conectada${conn.mp_nickname ? ` a ${conn.mp_nickname}` : ""}${
                              conn.last_checked_at ? ` · último chequeo ${fmtTime(conn.last_checked_at)}` : ""
                            }`}
                      </p>
                    ) : (
                      <p className="text-xs text-muted">Sin conectar</p>
                    )}
                  </div>
                  {conn ? (
                    <form action={disconnectMp}>
                      <input type="hidden" name="id" value={conn.id} />
                      <button className="btn btn-sm">Desconectar</button>
                    </form>
                  ) : (
                    <a href={`/api/mp/connect?account=${a.id}`} className="btn btn-sm">
                      Conectar con Mercado Pago
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-muted">
          Al conectar, iniciá sesión con la cuenta de Mercado Pago de esa persona (por ejemplo, la de Marian para «MP
          Marian»). Las transferencias a bancos y los cobros con posnet no se pueden verificar así.
        </p>
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
                    {i.type !== "klaviyo" ? i.config.url : i.config.list_id ? `Lista ${i.config.list_id}` : i.name}
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

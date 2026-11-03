import Link from "next/link";
import { getContext } from "@/lib/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { SubmitButton } from "@/components/submit-button";
import { finalizeAdConnection } from "../actions";

type Account = { account_id: string; name: string; currency: string; active: boolean };

export default async function ChooseAdAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ pending?: string }>;
}) {
  const ctx = await getContext();
  const { pending } = await searchParams;
  if (!ctx || !pending) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("ad_oauth_pending")
    .select("id, branch_id, accounts, branch:branches(name)")
    .eq("id", pending)
    .eq("user_id", ctx.userId)
    .maybeSingle();

  if (!data) {
    return (
      <div className="card mx-auto max-w-md space-y-3">
        <h1>La conexión venció</h1>
        <Link href="/marketing" className="btn">Volver a Marketing</Link>
      </div>
    );
  }

  const accounts = (data.accounts ?? []) as Account[];
  const branch = data.branch as unknown as { name: string } | null;

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h1>Elegí la cuenta publicitaria</h1>
        <p className="text-sm text-muted">
          ¿Cuál es la cuenta de Meta de la sucursal {branch?.name}? Solo se van a leer métricas: el CRM no puede crear
          ni modificar anuncios.
        </p>
      </div>
      <form action={finalizeAdConnection} className="card space-y-3">
        <input type="hidden" name="pending_id" value={data.id} />
        {accounts.map((a, i) => (
          <label
            key={a.account_id}
            className="flex cursor-pointer items-center gap-3 rounded-lg border border-line p-3 hover:bg-subtle"
          >
            <input type="radio" name="account_id" value={a.account_id} required defaultChecked={i === 0} />
            <span className="flex-1">
              <span className="block font-medium">{a.name}</span>
              <span className="text-xs text-muted">
                ID {a.account_id} · {a.currency}
                {!a.active && " · inactiva"}
              </span>
            </span>
          </label>
        ))}
        <div className="flex justify-end gap-2">
          <Link href="/marketing" className="btn">Cancelar</Link>
          <SubmitButton pendingText="Conectando...">Conectar esta cuenta</SubmitButton>
        </div>
      </form>
    </div>
  );
}

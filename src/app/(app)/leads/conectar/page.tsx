import Link from "next/link";
import { getContext } from "@/lib/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { SubmitButton } from "@/components/submit-button";
import { finalizeLeadPage } from "../actions";

// Elegir cuál de las páginas de Facebook es la de esta sucursal
export default async function ChooseLeadPage({ searchParams }: { searchParams: Promise<{ pending?: string }> }) {
  const ctx = await getContext();
  const { pending } = await searchParams;
  if (!ctx || !pending) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("lead_oauth_pending")
    .select("id, pages, branch:branches(name)")
    .eq("id", pending)
    .eq("user_id", ctx.userId)
    .maybeSingle();

  if (!data) {
    return (
      <div className="card mx-auto max-w-md space-y-3">
        <h1>La conexión venció</h1>
        <Link href="/leads" className="btn">Volver a Leads</Link>
      </div>
    );
  }
  const pages = data.pages as { id: string; name: string }[];
  const branch = (data.branch as unknown as { name: string } | null)?.name ?? "la sucursal";

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div>
        <h1>¿Cuál es la página de {branch}?</h1>
        <p className="page-sub">Los formularios de los anuncios de esa página van a llegar a Leads.</p>
      </div>
      <form action={finalizeLeadPage} className="card space-y-3">
        <input type="hidden" name="pending_id" value={data.id} />
        <ul className="space-y-2">
          {pages.map((p, i) => (
            <li key={p.id}>
              <label className="flex items-center gap-3 rounded-xl bg-subtle px-3 py-2.5 text-sm">
                <input type="radio" name="page_id" value={p.id} defaultChecked={i === 0} required />
                <span className="font-semibold">{p.name}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <SubmitButton>Conectar esta página</SubmitButton>
        </div>
      </form>
    </div>
  );
}

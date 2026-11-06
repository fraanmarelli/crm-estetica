import Link from "next/link";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { requireContactContext } from "@/lib/context";
import { dayRange, fmtTime, fullName, todayISO } from "@/lib/format";
import { rotateRegisterLink } from "./actions";
import { AutoRefresh, CopyLink, RotateButton } from "./client-bits";

type Registered = {
  id: string;
  first_name: string;
  last_name: string | null;
  phone: string | null;
  self_registered_at: string;
};

export default async function RegisterLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string; vista?: string }>;
}) {
  const ctx = await requireContactContext();
  const sp = await searchParams;
  const turnParams = `${sp.fecha && /^\d{4}-\d{2}-\d{2}$/.test(sp.fecha) ? `&fecha=${sp.fecha}` : ""}${sp.vista === "semana" ? "&vista=semana" : ""}`;
  const supabase = await createClient();
  const { start } = dayRange(todayISO());

  const [{ data: branch }, { data: today }] = await Promise.all([
    supabase.from("branches").select("intake_token").eq("id", ctx.currentBranch.id).single(),
    supabase
      .from("patients")
      .select("id, first_name, last_name, phone, self_registered_at")
      .eq("home_branch_id", ctx.currentBranch.id)
      .gte("self_registered_at", start)
      .order("self_registered_at", { ascending: false })
      .limit(30),
  ]);

  const h = await headers();
  const origin = (process.env.APP_URL ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`).replace(/\/$/, "");
  const url = `${origin}/registro/${branch?.intake_token ?? ""}`;
  const qr = await QRCode.toString(url, { type: "svg", margin: 1, width: 240, color: { dark: "#1f1b16", light: "#ffffff" } });
  const qrDownload = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr)}`;
  const list = (today ?? []) as Registered[];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <AutoRefresh />
      <div className="page-head">
        <div>
          <h1>Registro de pacientes</h1>
          <p className="page-sub">
            Link fijo de {ctx.currentBranch.name}: la paciente carga sus datos sola, desde el celular del local o desde
            el suyo con el QR.
          </p>
        </div>
        <Link href={`/pacientes/nuevo${turnParams ? `?turno=1${turnParams}` : ""}`} className="btn">
          Cargarla yo
        </Link>
      </div>

      <section className="card space-y-5">
        <div className="grid gap-5 sm:grid-cols-[240px_1fr] sm:items-center">
          <div className="mx-auto w-[240px] rounded-xl border border-line bg-white p-2" dangerouslySetInnerHTML={{ __html: qr }} />
          <div className="space-y-3 text-sm">
            <p>
              <b>Celular del local:</b> abrilo con el botón de abajo, guardalo en favoritos y pasale el celular a la
              paciente. Al terminar queda listo para la siguiente.
            </p>
            <p>
              <b>Su celular:</b> que escanee el QR. Podés imprimirlo y dejarlo en recepción.
            </p>
            <div className="flex flex-wrap gap-2">
              <a href={`${url}?local=1`} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                Abrir en el celular del local
              </a>
              <CopyLink url={url} />
              <a href={qrDownload} download={`registro-${ctx.currentBranch.name}.svg`} className="btn">
                Descargar QR
              </a>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted">
          El formulario solo crea pacientes: nadie puede ver datos desde ahí. Si alguien ya registrada lo completa de
          nuevo, no se duplica ni se cambian sus datos.
        </p>
        {ctx.canManageCurrentBranch && (
          <form action={rotateRegisterLink} className="border-t border-line pt-3">
            <RotateButton />
          </form>
        )}
      </section>

      <section className="space-y-3">
        <h2>Se registraron hoy</h2>
        <div className="card p-0">
          {list.length === 0 ? (
            <p className="p-4 text-sm text-muted">Todavía nadie. Aparecen acá apenas envían el formulario.</p>
          ) : (
            <ul className="divide-y divide-line">
              {list.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="w-12 text-sm text-muted num">{fmtTime(p.self_registered_at)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{fullName(p)}</span>
                    <span className="text-sm text-muted">{p.phone ?? ""}</span>
                  </span>
                  <Link href={`/turnos/nuevo?paciente=${p.id}${turnParams}`} className="btn btn-sm btn-primary">
                    Darle un turno
                  </Link>
                  <Link href={`/pacientes/${p.id}`} className="btn btn-sm">
                    Ver ficha
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

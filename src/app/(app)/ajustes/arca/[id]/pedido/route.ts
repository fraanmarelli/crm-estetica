import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Descarga el pedido de certificado (.csr) de un titular. Es público por naturaleza (no tiene la clave),
// pero lo baja solo quien configura la sucursal.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: conn } = await supabase.from("arca_connections").select("id, branch_id, cuit").eq("id", id).maybeSingle();
  if (!conn) return new NextResponse("No encontrado", { status: 404 });
  const { data: allowed } = await supabase.rpc("is_branch_admin", { p_branch: conn.branch_id });
  if (allowed !== true) return new NextResponse("Sin permiso", { status: 403 });

  const admin = createAdminClient();
  const { data: sec } = await admin.from("arca_secrets").select("csr").eq("connection_id", id).maybeSingle();
  if (!sec?.csr) return new NextResponse("Todavía no hay pedido", { status: 404 });
  return new NextResponse(sec.csr, {
    headers: {
      "Content-Type": "application/pkcs10",
      "Content-Disposition": `attachment; filename="pedido-certificado-${conn.cuit}.csr"`,
      "Cache-Control": "private, no-store",
    },
  });
}

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireManagerContext } from "@/lib/context";
import type { ImportRow } from "@/lib/sheet-import";

export type ChunkResult = { imported: number; already: number; crm: number; patients: number } | { error: string };

const MAX_ROWS = 400;
const isStr = (v: unknown) => typeof v === "string";

// Una tanda de filas de la planilla (las arma el navegador). Permiso: franquiciado o marca;
// la base lo vuelve a verificar y valida cada dato al guardarlo.
export async function importSheetChunk(rows: ImportRow[]): Promise<ChunkResult> {
  const ctx = await requireManagerContext();
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS) return { error: "Tanda inválida." };
  for (const r of rows) {
    if (!isStr(r?.ref) || !r.ref.startsWith("sheet:") || !isStr(r.date) || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
      return { error: "Hay una fila con datos inválidos." };
    }
    if (!Array.isArray(r.items) || !Array.isArray(r.payments) || r.items.length > 20 || r.payments.length > 20) {
      return { error: "Hay una fila con datos inválidos." };
    }
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_sheet_rows", { p_branch: ctx.currentBranch.id, p_rows: rows });
  if (error) return { error: `No se pudo importar: ${error.message}` };
  return data as ChunkResult;
}

// Al terminar: que Hoy, Pacientes y Números se vuelvan a armar con lo nuevo
export async function finishImport() {
  await requireManagerContext();
  revalidatePath("/", "layout");
}

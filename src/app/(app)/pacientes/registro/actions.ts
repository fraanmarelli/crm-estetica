"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireManagerContext } from "@/lib/context";

// El link anterior deja de funcionar (si se filtró o se imprimió de más)
export async function rotateRegisterLink() {
  const ctx = await requireManagerContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("rotate_intake_token", { p_branch: ctx.currentBranch.id });
  if (error) throw new Error(error.message);
  revalidatePath("/pacientes/registro");
}

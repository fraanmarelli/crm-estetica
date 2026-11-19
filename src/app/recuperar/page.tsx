import { RecoverForm } from "./recover-form";

// «¿Olvidaste tu contraseña?» (página pública). ?vencido=1 = volvió de un link que ya no sirve.
export default async function RecoverPage({ searchParams }: { searchParams: Promise<{ vencido?: string }> }) {
  const { vencido } = await searchParams;
  return <RecoverForm expired={vencido === "1"} />;
}

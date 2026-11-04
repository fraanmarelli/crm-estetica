// Cada palabra tiene que aparecer en el nombre, apellido, celular o DNI ("ana paz", "paz 3516").
// Recibe la consulta de Supabase sobre `patients` y le agrega los filtros.
export function applyPatientSearch<Q extends { or: (filters: string) => Q }>(query: Q, raw: string): Q {
  const words = raw
    .replace(/[,()%*\\.:"']/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, 4);
  let q = query;
  for (const w of words) {
    const digits = w.replace(/\D/g, "");
    const filters = [`first_name.ilike.%${w}%`, `last_name.ilike.%${w}%`];
    if (digits.length >= 3) filters.push(`phone.ilike.%${digits}%`, `dni.ilike.%${digits}%`);
    q = q.or(filters.join(","));
  }
  return q;
}

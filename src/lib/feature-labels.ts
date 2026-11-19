// Funciones que la marca puede apagar por sede (branches.disabled_features; ver docs/MAPA.md → Sucursales)
export const FEATURE_KEYS = ["ads", "mp", "promos", "integrations"] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type Features = Record<FeatureKey, boolean>;
export const FEATURE_LABEL: Record<FeatureKey, { title: string; detail: string }> = {
  ads: { title: "Anuncios y leads", detail: "Números → Anuncios, Contactar → Leads y la conexión con Facebook" },
  mp: { title: "Verificar transferencias de Mercado Pago", detail: "Chequeo de cada cobro y el aviso de las que no llegaron" },
  promos: { title: "Promos propias", detail: "Que la sede cree sus promos. Las de la red siguen apareciendo" },
  integrations: { title: "Planilla, calendario y Klaviyo", detail: "Envíos automáticos a Google Sheets, Calendar y Klaviyo" },
};
export function featuresFrom(disabled: string[] | null | undefined): Features {
  const off = new Set(disabled ?? []);
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, !off.has(k)])) as Features;
}

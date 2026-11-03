# CLAUDE.md — reglas del proyecto

CRM multi-sucursal para clínicas de estética (primer cliente: red Dr Beauty, Argentina).
El dueño del proyecto no es desarrollador: explicá los pasos manuales (Supabase, Vercel) con claridad
y entregá archivos completos.

## Stack
- Next.js 16 (App Router, `src/`, server actions, `proxy.ts` en vez de middleware), React 19, Tailwind 4.
- Supabase: Postgres + Auth (email/contraseña) + Edge Functions (Deno) + pg_cron/pg_net + Vault.
- Deploy en Vercel. Zona horaria fija: America/Argentina/Buenos_Aires (-03:00, sin horario de verano).
- UI en español rioplatense (es-AR). Moneda ARS.

## Jugadores (usar estos nombres en la UI)
- **Marca** = dueño de la red (roles `network_owner`, `network_admin`). Ve todo, costos incluidos. Define el
  catálogo de tratamientos y los insumos con su costo para las franquicias. No paga.
- **Franquiciado** = dueño de una sucursal (`branch_admin`). Ve su sucursal: números, costos, marketing. Paga el abono.
- **Recepción / Profesional** = equipo de la sucursal. Operación diaria. Nunca ven costos ni márgenes.
- **Pacientes** = clientes de las clínicas. No entran al CRM.

## Modelo de datos (ver `supabase/migrations/`)
- `organizations` (red/cliente) → `branches` (sucursales) → `memberships` (usuario + rol + sucursal).
- Pacientes pertenecen a la organización; `home_branch_id` = sucursal de origen.
- `appointments` + `appointment_items` (un turno, varios tratamientos). `treatments.recall_days` define el recall.
- Precio de venta: SIEMPRE manual en cada ítem (promos/descuentos). No hay lista de precios.
- Costo: `supplies.unit_cost` (lo carga la marca) × `appointment_items.quantity`, congelado en
  `appointment_items.cost` por trigger. `cost` y `unit_cost` no tienen SELECT para `authenticated`: se leen con
  `branch_financials()` / `supply_list()` (marca y franquiciado). `integrations.secret` tampoco es legible.
- `recall_queue` (vista) = último tratamiento realizado + recall_days, sin turno futuro, sin opt-out.
- `loyalty_transactions` = libro mayor de millas (nunca se edita; se corrige con otro movimiento).
- `event_outbox` + `integrations` = toda automatización saliente (tipos: `google_sheets`, `klaviyo`).
- Marketing: `ad_connections` (una cuenta de Meta por sucursal), `ad_connection_secrets` (tokens, solo
  service role), `ad_insights_daily` (gasto/resultados por campaña y día), `marketing_summary()` cruza con pacientes.
- Tareas programadas (pg_cron): `dispatch-events` cada minuto, `meta-sync` diario, `weekly-report` los lunes.

## Reglas que no se rompen
1. **Toda tabla nueva** lleva `organization_id`, y `branch_id` si es de una sucursal, con FK compuesta
   `(branch_id, organization_id) → branches(id, organization_id)`.
2. **Toda tabla nueva tiene RLS** usando los helpers: `is_org_member`, `has_network_access`,
   `can_access_branch`, `is_branch_admin`, `can_access_patient`. Nada de filtrar permisos solo en la UI.
3. **Migraciones:** nunca editar una ya aplicada. Archivo nuevo `supabase/migrations/AAAAMMDDHHMMSS_nombre.sql`.
   Probar antes en una base descartable.
4. **Automatizaciones:** no llamar APIs externas desde la app. Un trigger encola en `event_outbox`;
   `supabase/functions/dispatch-events` lo envía. Para un canal nuevo: nuevo `integrations.type` +
   handler en `HANDLERS` + (si hace falta) nuevo tipo de evento en el trigger y en `claim_outbox_events`.
5. **Escrituras** en server actions (`src/app/(app)/actions.ts`; partir por dominio cuando crezca),
   siempre validando del lado del servidor. Lecturas en Server Components.
6. **Datos de salud:** nunca loguear datos de pacientes. Respetar `consent_marketing_at` y
   `marketing_opt_out_at` en cualquier envío. Teléfonos se guardan normalizados (`normalize_phone`, 549...).
7. Funciones `security definer` siempre con `set search_path = public`; las internas, sin `execute` para
   `anon`/`authenticated`.
8. `createAdminClient()` (service role) solo en el servidor y solo después de verificar permisos en código.
   Los tokens de terceros nunca van al navegador ni a tablas legibles por usuarios.

## Próximos pasos previstos
- ABM de profesionales y de usuarios (invitar por email) desde la app.
- Importar pacientes/turnos históricos desde la planilla (CSV) usando `external_ref` (no se re-sincronizan).
- Editar el mensaje de recall y los `recall_days` desde Ajustes.
- Recordatorio previo al vencimiento del token de Meta (mail al franquiciado).
- Handler `whatsapp_cloud` en dispatch-events (recall automático con plantillas aprobadas por Meta).
- Página pública para que la paciente vea sus Beauty Millas.
- Tipos generados: `npx supabase gen types typescript --project-id <ref> > src/lib/database.types.ts`.

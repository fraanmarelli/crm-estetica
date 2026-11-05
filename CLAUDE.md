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
- Cobro: `payment_accounts` (cuentas por sucursal, ARS o USD) y `appointment_payments` (partes del cobro).
  `appointments.amount_paid` (ARS) / `amount_usd` / `payment_method` los calcula un trigger desde las partes.
  Las partes en USD suman a `amount_paid` solo si tienen `exchange_rate`. La seña es una parte con
  `is_deposit = true` cargada con el turno agendado; al registrarlo realizado se cobra solo el resto.
- Comisión: `professionals.commission_pct` × `amount_paid` → `appointments.commission` (trigger), o manual con
  `set_commission()`. `commission_pct` y `commission` no son legibles por `authenticated`; se leen con
  `professional_list()` / `appointment_commission()` / `branch_financials()`. Ingreso neto = facturado − insumos − comisión.
- Al guardar un turno realizado: se inserta como `scheduled`, después ítems y cobros, y al final el estado, para
  que las integraciones reciban el turno completo una sola vez.
- `appointment_event_payload()` incluye claves con los títulos de la planilla de Córdoba y una por cuenta de cobro.
- Promos: `promotions` (branch_id null = de la marca para toda la red; si no, de una sucursal) + `promotion_items`
  (uno = precio fijo, varios = combo). Al aplicarla en el turno el precio se reparte entre los ítems (editable) y
  cada ítem guarda `appointment_items.promotion_id` (columna «Promo» de la planilla). Crean/pausan: marca (red o
  sucursal) y franquiciado (la suya), con `can_manage_promotion()`.
- Facturación (monotributo): `account_holders` (titular, CUIT, `annual_limit` = tope de su categoría, `alert_pct`)
  por sucursal; `payment_accounts.holder_id` (sin titular = no suma, ej. efectivo). `holder_status()` da lo del mes
  y lo de los últimos 12 meses con `level` ok/warn/over; `billing_by_account()` lo de cada cuenta en un período.
  Los cobros se cuentan en el día del turno. Solo franquiciado y marca; la agenda avisa con warn/over.
- Verificación de transferencias MP: `mp_connections` (una cuenta de MP por `payment_accounts`, OAuth solo lectura,
  rutas `/api/mp/connect` y `/api/mp/callback`) + `mp_connection_secrets` (tokens, solo service role).
  Un trigger en `appointment_payments` crea `transfer_checks` (clave turno+cuenta+monto+seña, sobrevive a la edición
  del turno); la función `mp-verify` (cron cada minuto) usa `match.ts` (monto exacto, DNI de la paciente vs CUIT,
  ventana ±72 h, una transferencia valida un solo cobro) y marca pending/verified/review/not_found. Solo el
  servidor escribe los chequeos. `cleanup_transfer_checks()` borra los de cobros que ya no existen.
- `recall_queue` (vista) = último tratamiento realizado + recall_days, sin turno futuro, sin opt-out.
- `loyalty_transactions` = libro mayor de millas (nunca se edita; se corrige con otro movimiento).
- `event_outbox` + `integrations` = toda automatización saliente (tipos: `google_sheets`, `klaviyo`,
  `google_calendar`). Eventos: `appointment.saved` (cualquier cambio), `.completed`, `.updated` (cambio de un
  realizado), `.deleted`. `integration_refs` guarda el id externo (evento de Google) que devuelve el handler.
- `appointments.duration_minutes` define el largo del turno (calendario).
- Registro de pacientes: link fijo por sucursal `/registro/[branches.intake_token]` (público, sin sesión) que
  solo CREA pacientes (`patients.self_registered_at`). Recepción lo ve en `/pacientes/registro` (QR, link, se
  registraron hoy); el franquiciado lo cambia con `rotate_intake_token()`. El servidor valida el token y recién ahí
  usa `createAdminClient()`; tope de 10 registros por minuto por sucursal; si el celular o DNI ya existe no duplica
  ni modifica, y responde igual para no revelar quién es paciente.
- Ficha incompleta: carga rápida (nombre, celular, origen) para dar un turno sin tener a la paciente presente
  = `patients.consent_data_at is null`. Se completa en `/pacientes/[id]/completar`: a mano (el form pide el
  consentimiento) o con un link personal `/ficha/[patient_intakes.token]` (público, un uso, 7 días; el servidor
  valida el token y recién ahí usa `createAdminClient()`; solo completa campos, no borra). Agenda y cobro avisan.
- Equipo: `member_invites` (link personal `/invitacion/[token]`, 7 días, un uso; sin mail de Supabase: se manda
  por WhatsApp/mail desde el CRM). Al aceptar, el servidor valida el token y con service role crea el usuario
  (o suma el acceso si el mail ya tenía cuenta), la membresía y vincula `professionals.user_id`. `can_manage_role()`:
  marca invita marca/franquiciado/equipo; franquiciado, recepción y profesionales de su sucursal.
  `team_members()`, `branch_owners()`, `remove_membership()`. Sucursal nueva (marca, en /marca) arranca con cuentas
  de cobro genéricas por trigger (`seed_branch_accounts`).
- Búsqueda de pacientes: `applyPatientSearch()` (cada palabra en nombre, apellido, celular o DNI) + `LiveSearch`
  (filtra mientras se escribe actualizando `?q=`).
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
- **Consentimiento informado** en la ficha de ingreso: cláusulas por tratamiento + firma digital (dibujada en
  pantalla), guardado con fecha, versión del texto y paciente. Pedido explícito del dueño del proyecto.
- **Código de lote** del insumo usado (jeringa, vial, etc.) en cada ítem del cobro, por trazabilidad sanitaria
  (ANMAT). Pedido explícito del dueño del proyecto.
- **"Conectar con Google"** (OAuth) para Calendar y Sheets en vez de Apps Script: un botón, el CRM crea el
  calendario de la sucursal solo. Requiere proyecto en Google Cloud y verificación de la app por Google.
- **Exportar a Excel** los turnos/cobros por período, para sucursales que no necesitan sincronizar una planilla.
- Importar pacientes/turnos históricos desde la planilla (CSV) usando `external_ref` (no se re-sincronizan).
- Editar el mensaje de recall y los `recall_days` desde Ajustes.
- Recordatorio previo al vencimiento del token de Meta (mail al franquiciado).
- Handler `whatsapp_cloud` en dispatch-events (recall automático con plantillas aprobadas por Meta).
- Página pública para que la paciente vea sus Beauty Millas.
- Tipos generados: `npx supabase gen types typescript --project-id <ref> > src/lib/database.types.ts`.

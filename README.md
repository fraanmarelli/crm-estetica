# CRM Estética — v1

CRM para redes de clínicas de estética con franquicias: pacientes, turnos, recall por WhatsApp, Beauty Millas,
costos de insumos y márgenes por franquicia, publicidad de Meta cruzada con la facturación, eventos para Klaviyo,
mail semanal automático y copia de turnos a Google Sheets.

**Stack:** Next.js (Vercel) + Supabase (base de datos, login, tareas automáticas) + Google Apps Script + Resend.
**Costo del piloto:** US$0.

---

## Quién es quién

| Jugador | En el CRM (rol) | Ve | Hace |
|---|---|---|---|
| Dueño de la marca | **Marca** (`network_owner`) / su equipo (`network_admin`) | Todas las sucursales, costos incluidos | Catálogo, insumos y sus costos, panel de la marca |
| Dueño de una franquicia | **Franquiciado** (`branch_admin`) | Su sucursal, costos y márgenes incluidos | Todo lo de recepción + números + marketing + conectar Meta y Klaviyo |
| Equipo de la sucursal | **Recepción** (`reception`) / **Profesional** (`professional`) | Su sucursal | Pacientes, turnos, recall, millas |
| Clientes de las clínicas | **Pacientes** | Nada (no entran) | Reciben el WhatsApp de recall que manda recepción |

Los permisos los controla la base de datos (RLS), no la pantalla.

## Qué hace

| Pantalla | Quién | Qué hace |
|---|---|---|
| **Agenda** | Todos | Calendario del mes; al tocar un día: turnos, cobrado, cumpleaños, primeras visitas, notas de la paciente, botón para recordar el turno por WhatsApp |
| **Pacientes** | Todos | Alta (detecta duplicados en toda la marca; origen obligatorio), ficha e historial |
| **Turno** | Todos | Agendar y registrar como realizado: tratamiento, cantidad de insumo, precio cobrado (manual) y cobro dividido en varias cuentas |
| **Recall** | Todos | A quién le toca repetir, botón de WhatsApp con el mensaje armado, registrar respuesta |
| **Números** | Franquiciado y marca | Facturado, insumos, comisiones e ingreso neto; liquidación por médico; por cuenta de cobro, por tratamiento y mejores pacientes |
| **Insumos** | Marca edita, franquiciado consulta | Costo de cada insumo para las franquicias y qué insumo usa cada tratamiento |
| **Marketing** | Franquiciado y marca | Conectar Meta, inversión, mensajes, pacientes nuevas de redes, costo por paciente, retorno, campañas |
| **Marca** | Marca | Facturación, turnos y recall por sucursal, mes vs mes |
| **Ajustes** | Franquiciado y marca | Médicos y su comisión, cuentas de cobro, Klaviyo, Google Sheets, errores de envío |
| **Mail semanal** | Franquiciado y marca | Todos los lunes 9:05 (Argentina), automático |

---

## Instalación

### 1. Supabase

1. [supabase.com](https://supabase.com) → **New project**. Nombre `crm-estetica`, región **South America (São Paulo)**.
2. **SQL Editor → New query**. Corré uno por vez, en este orden, pegando el contenido completo de cada archivo:
   1. `supabase/migrations/20261103000000_init.sql`
   2. `supabase/migrations/20261103000100_cron_dispatch.sql`
   3. `supabase/migrations/20261103000200_marketing.sql`
   4. `supabase/migrations/20261103000300_marketing_cron.sql`
   5. `supabase/migrations/20261103000400_insumos_costos_klaviyo.sql`
   6. `supabase/migrations/20261103000500_cobros_comisiones.sql`
   7. `supabase/migrations/20261104000600_agenda_google_calendar.sql`
   8. `supabase/migrations/20261104000700_senas.sql`
   9. `supabase/migrations/20261104000800_ficha_ingreso.sql`
   10. `supabase/seed.sql` (siempre al final)

   O todo junto: el archivo `instalacion-crm.sql` que arma Claude con todos en orden.
3. **Authentication → Sign In / Providers → Email:** desactivá **"Allow new users to sign up"**.

### 2. Usuarios

Creá cada usuario en **Authentication → Users → Add user** (tildá **Auto Confirm User**) y después asignale
rol en el **SQL Editor**:

```sql
-- Vos y el dueño de la marca
select grant_membership('tu-email@gmail.com', 'drbeauty', 'network_owner');

-- Un franquiciado (dueño de su sucursal)
select grant_membership('franquiciado.cordoba@gmail.com', 'drbeauty', 'branch_admin', 'Córdoba');

-- Recepción de esa sucursal
select grant_membership('recepcion.cordoba@gmail.com', 'drbeauty', 'reception', 'Córdoba');
```

### 3. Médicos y cuentas de cobro

En el CRM → **Ajustes** (como marca o franquiciado): cargá los médicos de la sucursal con su % de comisión y
revisá las cuentas de cobro. Córdoba ya viene con las cuentas de su planilla (Efectivo, Dolar, GetNet Mariano,
MP Marian, GetNet Cami, GetNet Chari, MP CHARI, TR cuenta Mariano, TR Cuenta Franco).

### 4. Una clave interna

Inventá una clave larga (40 letras y números). Es la que usan las tareas automáticas para llamarse entre sí.

- Supabase → **Edge Functions → Secrets** → `DISPATCH_SECRET` = la clave.
- **SQL Editor:**

```sql
select vault.create_secret('https://xxxx.supabase.co', 'project_url');
select vault.create_secret('LA-CLAVE', 'dispatch_secret');
```

### 5. Funciones automáticas

Supabase → **Edge Functions → Deploy a new function → Via Editor**. Creá estas tres, cada una con el nombre
exacto y pegando su archivo. En cada una, en **Details**, desactivá **Verify JWT**.

| Nombre | Archivo | Qué hace |
|---|---|---|
| `dispatch-events` | `supabase/functions/dispatch-events/index.ts` | Copia turnos a Google Sheets (cada minuto) |
| `meta-sync` | `supabase/functions/meta-sync/index.ts` | Trae gasto y resultados de Meta (todas las mañanas) |
| `weekly-report` | `supabase/functions/weekly-report/index.ts` | Manda el mail semanal (lunes) |

### 6. GitHub

```bash
git init
git add .
git commit -m "CRM v1"
git branch -M main
```

Creá el repositorio vacío y privado `crm-estetica` en [github.com/new](https://github.com/new):

```bash
git remote add origin https://github.com/fraanmarelli/crm-estetica.git
git push -u origin main
```

### 7. Vercel

1. [vercel.com/new](https://vercel.com/new) → importá `fraanmarelli/crm-estetica`.
2. **Environment Variables** (ver `.env.example`):

| Variable | De dónde sale |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → API Keys → Publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → API Keys → Secret key |
| `APP_URL` | La URL de Vercel, ej. `https://crm-estetica.vercel.app` |
| `DISPATCH_SECRET` | La clave del paso 4 |
| `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID` | Paso 8 (podés agregarlas después) |

3. **Deploy.** Logueate con tu usuario.

### 8. Meta (para que cada sucursal conecte su publicidad)

1. [developers.facebook.com](https://developers.facebook.com) → **My Apps → Create App** → caso de uso de
   **Marketing API / medir rendimiento de anuncios**, tipo **Business**. Conectala a tu portfolio comercial
   (tu empresa, no la de Dr Beauty: si después vendés el CRM a otras redes, la app tiene que ser tuya).
2. Agregá **Facebook Login for Business** → **Configurations → Create**: token de usuario, permiso **ads_read**.
   Copiá el **ID de la configuración** → `META_CONFIG_ID` en Vercel.
3. **Facebook Login for Business → Settings → Valid OAuth Redirect URIs:**
   `https://crm-estetica.vercel.app/api/meta/callback` (con tu URL real).
4. **App settings → Basic:** App ID → `META_APP_ID`, App Secret → `META_APP_SECRET` en Vercel. Redeploy.
5. En el CRM → **Marketing → Conectar con Facebook** → elegí la cuenta de la sucursal.

**Importante:** mientras la app esté en modo desarrollo, solo pueden conectar personas con rol en la app (vos).
Para que cualquier franquiciado conecte su cuenta, pedí en **App Review** el **acceso avanzado a `ads_read`** y
completá la **verificación del negocio**. Mientras tanto, el piloto funciona con tu cuenta de Córdoba.

La conexión de Facebook dura unos 60 días: el CRM avisa cuando está por vencer y se renueva con «Reconectar».

### 9. Insumos y costos

En el CRM → **Insumos** (como marca): cargá el costo de cada insumo para las franquicias y revisá qué insumo usa
cada tratamiento. Desde ahí, cada turno realizado calcula su costo con la cantidad que carga recepción.
El precio de venta no está en el catálogo: se escribe en cada turno (promos y descuentos).

### 10. Klaviyo (email marketing por tratamiento)

Cada franquiciado, en **Ajustes → Conectar → Klaviyo**, pega la clave privada de su cuenta (`pk_...`). Cada
tratamiento realizado llega a Klaviyo como evento «Tratamiento realizado» con `tratamiento` y
`proximo_vencimiento`. En Klaviyo se arma un flow por tratamiento (disparador: ese evento; filtro por tratamiento;
espera; mail). Solo se envían pacientes con email y que aceptaron recibir comunicaciones.

### 11. Google Calendar (opcional)

Cada turno que se crea o edita en el CRM se crea o actualiza en el calendario de Google de la sucursal. Si se
cancela o se borra, se borra el evento. Los realizados quedan en verde y los ausentes en rojo. Los cambios hechos
a mano en Google no vuelven al CRM.

1. Con la cuenta de Google de la sucursal: [script.google.com](https://script.google.com) → **Nuevo proyecto**.
   Pegá `google-apps-script/Calendario.gs`. En `CONFIG` cambiá `TOKEN` (una clave larga) y, si querés un
   calendario aparte, pegá su ID en `CALENDAR_ID`.
2. Elegí `probarEvento` → **Ejecutar** → aceptá los permisos. Tiene que aparecer un evento dentro de una hora.
3. **Implementar → Nueva implementación → Aplicación web**, «Ejecutar como: yo», «Quién tiene acceso: cualquier
   usuario». Copiá la URL `/exec`.
4. CRM → **Ajustes → Conectar → Google Calendar**: pegá la URL y el token. Los turnos de hoy en adelante se
   cargan solos en unos minutos.

Requiere la función `dispatch-events` y los secretos del paso 4. Para que el evento tenga el link al turno,
agregá `APP_URL` en Supabase → Edge Functions → Secrets.

### 12. Google Sheets (opcional)

1. Configurá `google-apps-script/Code.gs` en la planilla (instrucciones dentro del archivo).
2. CRM → **Ajustes** → pegá la URL de Apps Script y el token.

### 13. Mail semanal

1. Creá una cuenta en [resend.com](https://resend.com) (gratis hasta 3.000 mails/mes) y **verificá un dominio**
   (te da registros DNS para pegar donde compraste el dominio). Sin dominio verificado solo puede enviarte a vos.
2. Supabase → **Edge Functions → Secrets:**
   - `RESEND_API_KEY` = la API key de Resend
   - `REPORT_FROM` = `Dr Beauty CRM <reportes@tudominio.com>`
   - `APP_URL` = la URL del CRM
3. Probalo mandándotelo solo a vos (SQL Editor):

```sql
select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
         || '/functions/v1/weekly-report?solo=tu-email@gmail.com',
  headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret',
             (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_secret')),
  body := '{}'::jsonb
);
```

Lo reciben la marca (todas las sucursales) y cada franquiciado (su sucursal). Recepción y pacientes, no.

---

## Cómo se calcula el retorno de la publicidad

- **Pacientes nuevas de redes:** dadas de alta en el período que respondieron Instagram o Facebook en
  «¿Cómo nos conoció?» (campo obligatorio).
- **Facturado:** lo que pagaron esas pacientes desde su alta hasta hoy.
- **Retorno:** facturado ÷ inversión en Meta de la sucursal.

Es por sucursal y período, no anuncio por anuncio. Para atribución exacta por anuncio hace falta la API de
WhatsApp (etapa futura).

## Desarrollo local (opcional)

```bash
npm install
cp .env.example .env.local   # completá las variables
npm run dev                  # http://localhost:3000
```

## Estructura

```
src/
  app/
    login/                 ingreso
    api/meta/              conexión con Facebook (OAuth)
    (app)/                 todo lo que requiere sesión
      page.tsx             Hoy
      pacientes/  turnos/  recall/
      numeros/             facturado, costo y margen de la franquicia
      insumos/             costos de insumos (marca) y su uso por tratamiento
      marketing/           Meta x CRM por sucursal y para la marca
      marca/               panel de la marca
      ajustes/             integraciones
      actions.ts           escrituras (server actions)
  components/  lib/  proxy.ts
supabase/
  migrations/              esquema (nunca se edita una aplicada: se agrega otra)
  seed.sql                 Dr Beauty, sucursales y tratamientos
  functions/               dispatch-events, meta-sync, weekly-report
google-apps-script/Code.gs receptor en la planilla
```

## Datos personales

Son datos de salud (Ley 25.326, datos sensibles). La app exige el consentimiento al dar de alta una paciente y
registra aparte si acepta recordatorios. Antes de usarlo con pacientes reales: política de privacidad visible en la
clínica e inscripción de la base ante la AAIP. Los tokens de Meta se guardan en una tabla a la que ningún usuario
tiene acceso.

# Mapa del CRM

Dónde está cada cosa y dónde va cada función nueva. **Ninguna función nueva se programa sin un lugar
aprobado en este mapa** (ver «Reglas del producto» en `CLAUDE.md`). Si un pedido no encaja, se propone
dónde iría (o qué cambiar del mapa) y se aprueba antes de programar.

## Principios

1. **Una pantalla por trabajo, no por función.** Se piensa en lo que la persona viene a hacer («a quién le
   escribo hoy»), no en la tabla que hay atrás. Antes de sumar una pantalla, buscar en cuál entra.
2. **Menú corto:** máximo 5 ítems (6 para la marca). Para sumar uno hay que fusionar o sacar otro.
   Lo secundario va en pestañas dentro de un ítem.
3. **Lo básico a la vista, lo avanzado plegado.** Lo que se usa todos los días aparece sin tocar nada;
   lo que se configura una vez va plegado (y se pliega solo cuando ya está configurado).
4. **Funciona sin configurar.** Cada función arranca con un valor por defecto razonable; Ajustes lo
   ajusta, no lo habilita.
5. **Cada persona ve solo lo suyo.** Sin botones deshabilitados ni «no tenés permiso»: lo que no le
   corresponde no aparece. Recepción y profesionales nunca ven costos, márgenes ni facturación.
6. **Una sola casa por dato.** Cada dato se edita en un único lugar; los demás lo muestran y llevan
   ahí con un link.
7. **Los avisos son tareas.** Un aviso solo aparece si hay algo para hacer, dice qué hacer y lleva ahí.
   Van todos juntos en «Pendientes» de Hoy, del más urgente al menos, con un máximo a la vista.

Leyenda: ✅ existe · 🆕 previsto (no programado) · 🔀 se movió de lugar.

---

## Menú por rol

| # | Menú | Ruta | Trabajo | Profesional | Recepción | Franquiciado | Marca |
|---|---|---|---|---|---|---|---|
| 1 | Hoy | `/` | «¿Qué tengo hoy y qué está pendiente?» | ✅ | ✅ | ✅ | ✅ |
| 2 | Pacientes | `/pacientes` | Buscar, cargar y completar fichas | ✅ | ✅ | ✅ | ✅ |
| 3 | Contactar | `/leads`, `/recall` | «¿A quién le escribo para que saque turno?» | — | ✅ | ✅ | ✅ |
| 4 | Números | `/numeros` y pestañas | «¿Cómo viene la sucursal?» | — | — | ✅ | ✅ |
| 5 | Sucursales {marca} | `/marca` | Sucursales, franquiciados y catálogo de la red (en el celular: «Sucursales») | — | — | — | ✅ |
| 6 | Ajustes | `/ajustes` y pestañas | Configurar la sucursal (una vez) | — | — | ✅ | ✅ |

Profesional: 2 ítems · Recepción: 3 · Franquiciado: 5 · Marca: 6.
El selector de sucursal (arriba) cambia la sucursal de todas las pantallas.

---

## 1. Hoy (`/`)

De arriba hacia abajo:

1. **Topes del monotributo** ✅ (solo franquiciado y marca, cuando un titular pasa el % de alerta o el tope).
2. **Números del día** ✅: turnos, cobrado, para recontactar.
3. **Pendientes** ✅ (una sola lista, máximo 4 a la vista y el resto plegado), en este orden:
   turnos de días anteriores sin cerrar → leads sin contactar → leads para volver a escribir →
   pacientes que vienen por primera vez → cumpleaños.
4. **Agenda del día o de la semana** ✅: «Por atender» y «Atendidas · No vinieron», con WhatsApp de
   recordatorio, ficha incompleta y estado de la transferencia.
5. Agendar turno ✅ → `/turnos/nuevo`. Turno → `/turnos/[id]` (cobro, ítems, promo, seña).

## 2. Pacientes (`/pacientes`)

- Buscar mientras se escribe ✅, ficha (`/pacientes/[id]`) con historial, datos y millas ✅.
- Cargar paciente ✅ (`/pacientes/nuevo`; carga rápida para dar turno sin tenerla presente).
- Completar ficha ✅ (`/pacientes/[id]/completar`: a mano o QR/link para la paciente).
- Registro por QR de la sucursal ✅ (`/pacientes/registro`).
- 🆕 **Consentimiento informado con firma**: va en la ficha (pestaña o sección «Consentimientos») y se
  pide al completar la ficha. Las cláusulas por tratamiento las define la marca en **Sucursales**.
- 🆕 **Importar historial** (CSV): acción secundaria plegada en Pacientes, solo franquiciado y marca.
- 🆕 **Beauty Millas pública**: link desde la ficha («Mandarle su saldo»).

## 3. Contactar (`/leads` · `/recall`)

Pestañas: **Leads · Recall**.

- **Leads** ✅: Sin contactar → Escritos · esperando respuesta (a los 2 días, «volver a escribir») →
  historial plegado (sacaron turno · descartados) → este mes por campaña → «Conexión con Facebook» plegada
  al final (volver a importar, desconectar). Sin conectar o con error, el aviso va arriba. «Darle turno» crea
  la paciente. La conexión la ven solo franquiciado y marca.
- **Recall** ✅: pacientes a las que les toca volver según el tratamiento, con su WhatsApp.
- 🆕 **WhatsApp automático** (recall con plantillas aprobadas): se prende en Ajustes; acá solo se ve
  «enviado automático» en cada fila.

## 4. Números (`/numeros` · `/facturacion` · `/marketing` · `/insumos`)

Pestañas: **Ventas · Facturación · Anuncios · Insumos**. Solo franquiciado y marca.

- **Ventas** ✅ (`/numeros`): período, facturado, insumos, comisión, neto; por profesional, cuenta de
  cobro, tratamiento; pacientes que más gastaron.
  - 🆕 **Exportar a Excel** turnos y cobros del período: botón secundario arriba a la derecha.
- **Facturación** ✅ (`/facturacion`): titulares del monotributo, lo del mes y 12 meses contra el tope,
  cuentas de cada titular.
  - 🆕 **Facturar en ARCA**: acción por cobro desde acá (no pantalla nueva).
- **Anuncios** ✅ (`/marketing`): gasto y resultados de Meta cruzados con pacientes.
- **Insumos** ✅ (`/insumos`): costo por insumo y qué usa cada tratamiento (la marca edita, el
  franquiciado consulta).

## 5. Sucursales {marca} (`/marca`) — solo marca (ej. «Sucursales Dr Beauty»)

- Sucursales y franquiciados ✅ (crear sucursal, invitar franquiciado), equipo de la marca ✅.
- Catálogo de tratamientos ✅ y promos de toda la red (se crean en Ajustes → Promos eligiendo «toda la red»).
- 🆕 Números comparados entre sucursales.
- 🆕 Textos del consentimiento informado por tratamiento.

## 6. Ajustes (`/ajustes` · `/promos`)

Pestañas: **General · Promos**. Solo franquiciado y marca. En General, cada sección plegada (se pliega
sola si ya está configurada):

- Equipo ✅ · Médicos y comisión ✅ · Cuentas de cobro ✅ · Mercado Pago (verificar transferencias) ✅ ·
  Planilla, calendario y Klaviyo ✅ · Errores de envío ✅.
- **Promos** ✅ (`/promos`): vigentes, nueva promo, pausadas o vencidas. Al cobrar se eligen en el turno.
- 🆕 **Mensajes**: recordatorio, cumpleaños, recall y leads (una sección plegada en General).
- 🆕 **Días de recall** por tratamiento: misma sección que Mensajes.
- 🆕 **Conectar con Google** (Calendar/Sheets): reemplaza el contenido de «Planilla, calendario y Klaviyo».
- 🆕 **Código de lote**: no es un ajuste; se carga en cada ítem del cobro del turno (`/turnos/[id]`).

---

## Páginas públicas (sin sesión)

`/registro/[token]` (alta de paciente) · `/ficha/[token]` (completar ficha) · `/invitacion/[token]`
(sumarse al equipo) · `/privacidad` · `/borrado-de-datos`.

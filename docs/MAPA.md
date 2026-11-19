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
| 3′ | Mis comisiones | `/comisiones` | «¿Cuánto me toca este mes?» | ✅ | — | — | — |
| 3 | Contactar | `/leads`, `/recall` | «¿A quién le escribo para que saque turno?» | — | ✅ | ✅ | ✅ |
| 4 | Números | `/numeros` y pestañas | «¿Cómo viene la sucursal?» | — | — | ✅ | ✅ |
| 5 | Sucursales {marca} | `/marca` | Sucursales, franquiciados y catálogo de la red (en el celular: «Sucursales») | — | — | — | ✅ |
| 6 | Ajustes | `/ajustes` y pestañas | Configurar la sucursal (una vez) | — | — | ✅ | ✅ |

Profesional: 3 ítems · Recepción: 3 · Franquiciado: 5 · Marca: 6.
**La profesional solo ve** ✅: en Hoy solo sus turnos y sin cobrar ni montos; la ficha en solo lectura (sin
editar datos, sin millas, sin nuevo turno); el turno como resumen. Escribe notas en la historia clínica. La base
lo hace cumplir (turnos, cobros, pacientes y millas: solo marca, franquiciado y recepción).
**Ver como** ✅ (solo la marca): en la barra lateral (celular: franja bajo la barra de arriba) se elige
Franquiciado/a, Recepción o una profesional y la app se arma como la ve ese rol, con un aviso arriba.
**Mostrar lo que viene** ✅ (solo la marca, debajo de «Ver como»): para mostrar el producto. Las funciones 🆕 de este
mapa aparecen en gris con «Próximamente», en su lugar y sin poder tocarlas (y Mercado Pago, mientras no conecta).
Apagado, la app es la de siempre; el equipo nunca lo ve.
El selector de sucursal (arriba) cambia la sucursal de todas las pantallas.

---

## 1. Hoy (`/`)

De arriba hacia abajo:

1. **Topes del monotributo** ✅ (solo franquiciado y marca, cuando un titular pasa el % de alerta o el tope).
2. **Números del día** ✅: turnos, cobrado, para recontactar.
3. **Pendientes** ✅ (una sola lista, máximo 4 a la vista y el resto plegado), en este orden:
   transferencias que no llegaron o hay que revisar, de cualquier día ✅ (abre el turno; «Ya lo revisé» solo
   franquiciado y marca; recepción la ve para pedirle el comprobante) → turnos de días anteriores sin cerrar → leads sin contactar → leads para volver a escribir →
   pacientes que vienen por primera vez → cumpleaños.
4. **Agenda del día o de la semana** ✅: «Por atender» y «Atendidas · No vinieron», con WhatsApp de
   recordatorio, ficha incompleta y estado de la transferencia.
5. Agendar turno ✅ → `/turnos/nuevo`. Turno → `/turnos/[id]` (cobro, ítems, promo, seña). En cada ítem:
   zona (con sugerencias), cantidad y **lote** ✅ (propone el último de la sucursal). El cobro es solo cobro: las
   notas clínicas van en la ficha. **En la compu el turno y el nuevo turno se abren como ventana** encima de la
   agenda o la ficha ✅ (✕, Esc, afuera o atrás la cierran); en el celular, pantalla completa con «← Volver».

## 2. Pacientes (`/pacientes`)

- Buscar mientras se escribe ✅, ficha (`/pacientes/[id]`) con historial, datos y millas ✅.
- **Ficha ordenada por lo que se hace con ella** ✅: arriba quién es (celular, edad, desde cuándo, WhatsApp, Nuevo
  turno) y «Para tener en cuenta». Columna principal: **Turnos** (Hoy abierto con «Registrar atención»; Próximos y
  Pasados plegados; sin turnos por delante: cuándo le toca volver y «Agendar») → **Salud** plegada (la alergia se ve
  en el título; no la ve recepción) → **Notas clínicas** plegadas → **Como paciente** plegado (visitas, facturado,
  por visita y, para franquiciado y marca, **lo que dejó**: facturado − insumos − comisión, `patient_financials()`).
  Columna derecha: **Pasaporte Dr Beauty** (millas y canje) y **Datos**. La profesional no ve montos.
- Cargar paciente ✅ (`/pacientes/nuevo`; carga rápida para dar turno sin tenerla presente).
- Completar ficha ✅ (`/pacientes/[id]/completar`: a mano o QR/link para la paciente).
- 🆕 **DNI o CUIT** en la ficha: la sucursal elige qué pedir (DNI, CUIT o los dos) en el registro y la ficha; si es
  empresa y dejó el DNI, «Buscar CUIT» lo completa (ver Facturar en ARCA).
- Registro por QR de la sucursal ✅ (`/pacientes/registro`).
- **Historia clínica** ✅ (en la ficha; solo profesionales, franquiciado y marca; recepción ve la tabla de
  turnos de siempre): resumen por tratamiento (×N · última fecha) y una línea de tiempo con cada sesión atendida
  (fecha grande, profesional, tratamiento con zonas y cantidades, lote) y sus notas, más las notas sueltas.
  **Antecedentes** ✅ fijo arriba (alergias en rojo, medicación, condiciones, tratamientos previos; se editan).
  **Notas** ✅: un solo «+ Nota» arriba que pregunta «¿Sobre qué sesión?» (la última elegida) o «General». Quedan
  con autora y hora, debajo de su sesión, y no se editan. Se escriben desde la ficha, no desde el turno.
- **Dos tipos de nota, nada más** ✅: «Para tener en cuenta» (operativa, la ve todo el equipo: franja amarilla
  arriba de la ficha, en la agenda y en el turno; reemplaza el campo «Notas») e «Historia clínica» (médica).
  El «Comentario del turno» (columna de la planilla) queda escondido tras «+ Comentario del turno».
- 🆕 **Fotos antes/después**: en la ficha, dentro de cada sesión de la historia clínica, y para subir en el turno.
- 🆕 **Consentimiento informado con firma**: va en la ficha (pestaña o sección «Consentimientos») y se
  pide al completar la ficha. Las cláusulas por tratamiento las define la marca en **Sucursales**.
- **Importar historial** ✅ (`/pacientes/importar`, botón secundario en Pacientes, solo franquiciado y marca): el CSV de
  la hoja de la sucursal (Google Sheets → Descargar → .csv). Vista previa antes de guardar (visitas, pacientes, cobrado,
  tratamientos reconocidos, médicos, filas que no entran) y después «Importar». Se puede repetir: solo entra lo nuevo.
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

Pestañas: **Ventas · Comisiones · Facturación · Anuncios · Insumos · Cambios**. Solo franquiciado y marca.

- **Ventas** ✅ (`/numeros`): período, facturado, insumos, comisión, neto; por profesional, cuenta de
  cobro, tratamiento; pacientes que más gastaron.
  - 🆕 **Exportar a Excel** turnos y cobros del período: botón secundario arriba a la derecha.
- **Comisiones** ✅ (`/comisiones`): por mes, «Todas» o una profesional: resumen por profesional y turno por
  turno (cobrado y comisión). La profesional ve la misma pantalla solo con lo suyo, como «Mis comisiones».
- **Facturación** ✅ (`/facturacion`): titulares del monotributo, lo del mes y 12 meses contra el tope,
  cuentas de cada titular.
  - **Factura electrónica (ARCA)** ✅ (nov 2026; falta probarla con ARCA de verdad): nada automático, se factura solo lo que se decide.
    - **Facturas emitidas** en esta pestaña: lista del período por titular (número, fecha, cliente, total, PDF,
      «Anular» = nota de crédito) y botón **«Nueva factura»** para una suelta, sin turno: titular, líneas
      (descripción · cantidad × precio), productos o servicios (arranca en productos), cliente consumidor final
      sin identificar o con DNI/CUIT (obligatorio desde $10 M).
    - **«Facturar» en el turno atendido** (tarjeta «Factura» arriba del cobro; desde la ficha se abre el turno): abre `/facturas/nueva?turno=…` con el titular
      de la cuenta que cobró, el monto cobrado en ella (editable), los tratamientos como líneas y el DNI de la
      paciente; arranca en servicios. Un turno cobrado en cuentas de dos titulares = una factura por titular.
      Ya facturado: muestra «Factura C 0003-00000123» con el PDF.
    - Facturan franquiciado, marca y recepción; las profesionales no lo ven. Cada titular emite con su CUIT.
    - 🆕 «Buscar CUIT» desde el DNI (padrón de ARCA): más adelante.
- **Cambios** ✅ (`/cambios`): lo que hizo recepción (o cualquiera que no sea franquiciado ni marca) y conviene
  mirar: cobro editado de un turno ya atendido (antes → después por cuenta), turno atendido que pasó a otro
  estado y millas cargadas a mano. «Revisado» uno o todos; Pendientes de Hoy avisa cuántos hay.
- **Anuncios** ✅ (`/marketing`): gasto y resultados de Meta cruzados con pacientes.
- **Insumos** ✅ (`/insumos`): **Buscar lote** ✅ arriba (a qué pacientes se les aplicó; la marca puede buscar
  en toda la red), costo por insumo y qué usa cada tratamiento (la marca edita, el franquiciado consulta).

## 5. Sucursales {marca} (`/marca`) — solo marca (ej. «Sucursales Dr Beauty»)

- Sucursales y franquiciados ✅ (crear sucursal, invitar franquiciado), equipo de la marca ✅.
  - **Ventana del franquiciado** ✅: tocar un franquiciado (o «Funciones» en una sede sin franquiciado) abre una
    ventana con su último ingreso, el mes de la sede (atendidas, facturado, no vinieron, recall), equipo y
    conexiones, y los **interruptores de funciones de la sede** ✅: Anuncios y leads · Mercado Pago · Promos
    propias · Planilla y calendario. Apagada = desaparece para toda la sede (menú, pestañas, Pendientes,
    Ajustes) y la base deja de hacerla; lo cargado queda guardado. En la lista, «N funciones apagadas».
- Catálogo de tratamientos ✅ y promos de toda la red (se crean en Ajustes → Promos eligiendo «toda la red»).
- 🆕 Números comparados entre sucursales.
- 🆕 Textos del consentimiento informado por tratamiento.

## 6. Ajustes (`/ajustes` · `/promos`)

Pestañas: **General · Promos**. Solo franquiciado y marca. En General, cada sección plegada (se pliega
sola si ya está configurada):

- Equipo ✅ (con «Link para nueva contraseña» ✅ por persona, para mandar por WhatsApp) · Médicos y comisión ✅ · Cuentas de cobro ✅ · Mercado Pago (verificar transferencias) ✅ (muestra a nombre de quién quedó cada cuenta y no deja conectar la misma cuenta de MP dos veces ✅) ·
  Planilla y calendario ✅ (Klaviyo oculto desde nov 2026) · Errores de envío ✅.
- 🆕 **Email marketing propio** (más adelante, en vez de Klaviyo): recall por tratamiento y cumpleaños por mail desde el
  CRM con Resend, respetando el consentimiento; se configura en Ajustes → Mensajes.
- **Promos** ✅ (`/promos`): vigentes, nueva promo, pausadas o vencidas. Al cobrar se eligen en el turno.
- **Recall** ✅ (sección plegada en General, solo franquiciado y marca): mensaje de WhatsApp de la sucursal con vista
  previa, y cada cuántos días vuelve cada tratamiento (arranca con lo del catálogo de la marca; vacío = sin recall).
- 🆕 **Mensajes**: recordatorio, cumpleaños y leads (otra sección plegada en General).
- **Factura electrónica** ✅ (sección plegada en General, solo franquiciado y marca): un renglón por titular con su
  estado y «Conectar ARCA». Cada titular usa su propio certificado: datos de la factura (razón social, CUIT, domicilio
  comercial, IIBB, inicio de actividades, punto de venta Web Services) → «Descargar pedido de certificado» (.csr) →
  lo sube en ARCA y trae el certificado → «Probar conexión». Ambiente de prueba o real. Avisa en Pendientes 30 días
  antes de que venza el certificado (dura 2 años). La clave privada queda solo en el servidor.
- 🆕 **Conectar con Google** (Calendar/Sheets): reemplaza el contenido de «Planilla y calendario».

---

## Páginas públicas (sin sesión)

`/registro/[token]` (alta de paciente) · `/ficha/[token]` (completar ficha) · `/invitacion/[token]`
(sumarse al equipo) · `/privacidad` · `/borrado-de-datos` · `/recuperar` ✅ («¿Olvidaste tu contraseña?» en el
login: manda un link al mail, que entra por `/auth/confirmar` y lleva a `/nueva-contrasena`).

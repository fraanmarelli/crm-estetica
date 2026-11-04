/**
 * Puente CRM -> Google Calendar (Dr Beauty)
 *
 * El CRM manda cada turno que se crea, edita, cancela o borra, y este script
 * mantiene el evento correspondiente en el calendario de la cuenta de Google
 * que publica el script.
 *
 *   - Turno nuevo o editado  -> crea o actualiza el evento
 *   - Realizado              -> el evento queda en verde con "✓"
 *   - No vino                -> el evento queda en rojo
 *   - Cancelado o borrado    -> se borra el evento
 *
 * Los cambios que se hagan a mano en Google Calendar NO vuelven al CRM:
 * los turnos se editan siempre en el CRM.
 */

// ===================== CONFIGURACIÓN =====================
const CONFIG = {
  TOKEN: 'CAMBIAR-ESTE-TOKEN',   // Clave secreta. Poné la misma en el CRM (Ajustes).
  CALENDAR_ID: '',               // Vacío = calendario principal de esta cuenta.
                                 // Recomendado: crear un calendario "Turnos Córdoba" y pegar
                                 // acá su ID (Configuración del calendario > Integrar calendario).
  MINUTOS_AVISO: 60              // Aviso en el celular antes del turno. 0 = sin aviso.
};
// =========================================================


function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.token !== CONFIG.TOKEN) {
      return json_({ ok: false, error: 'Token inválido' });
    }

    lock.waitLock(20000);

    const cal = CONFIG.CALENDAR_ID
      ? CalendarApp.getCalendarById(CONFIG.CALENDAR_ID)
      : CalendarApp.getDefaultCalendar();
    if (!cal) {
      return json_({ ok: false, error: 'No se encontró el calendario ' + CONFIG.CALENDAR_ID });
    }

    // Evento ya creado para este turno (si alguien lo borró a mano, se vuelve a crear)
    let ev = null;
    if (data.external_id) {
      try {
        ev = cal.getEventById(data.external_id);
      } catch (err) {
        ev = null;
      }
    }

    const borrar = data.evento === 'appointment.deleted' || !data.inicio || data.estado === 'cancelled';
    if (borrar) {
      if (ev) ev.deleteEvent();
      return json_({ ok: true, accion: 'borrado', external_id: null });
    }

    const inicio = new Date(data.inicio);
    const fin = new Date(inicio.getTime() + (Number(data.duracion_min) || 30) * 60000);
    const titulo = titulo_(data);
    const descripcion = descripcion_(data);
    const lugar = data.sucursal ? 'Dr Beauty ' + data.sucursal : '';
    let accion;

    if (ev) {
      ev.setTitle(titulo);
      ev.setTime(inicio, fin);
      ev.setDescription(descripcion);
      ev.setLocation(lugar);
      accion = 'actualizado';
    } else {
      ev = cal.createEvent(titulo, inicio, fin, { description: descripcion, location: lugar });
      if (CONFIG.MINUTOS_AVISO > 0) ev.addPopupReminder(CONFIG.MINUTOS_AVISO);
      accion = 'creado';
    }

    if (data.estado === 'completed') ev.setColor(CalendarApp.EventColor.GREEN);
    else if (data.estado === 'no_show') ev.setColor(CalendarApp.EventColor.RED);
    else ev.setColor(CalendarApp.EventColor.PALE_BLUE);

    return json_({ ok: true, accion: accion, external_id: ev.getId() });

  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    try { lock.releaseLock(); } catch (ignored) {}
  }
}


// Para comprobar desde el navegador que el script está publicado
function doGet() {
  return json_({ ok: true, mensaje: 'Puente CRM -> Google Calendar activo' });
}


// Prueba manual: ejecutala desde el editor (botón "Ejecutar"). Crea un evento
// dentro de una hora en el calendario configurado. Borralo después a mano.
function probarEvento() {
  const fake = {
    postData: {
      contents: JSON.stringify({
        token: CONFIG.TOKEN,
        evento: 'appointment.saved',
        id_crm: 'TEST-001',
        inicio: new Date(Date.now() + 60 * 60000).toISOString(),
        duracion_min: 30,
        estado: 'scheduled',
        paciente: 'Paciente de prueba',
        tratamiento: 'Botox (toxina botulínica) - Frente',
        profesional: 'Dra. Prueba',
        telefono: '5491100000000',
        sucursal: 'Córdoba'
      })
    }
  };
  Logger.log(doPost(fake).getContent());
}


// ===================== HELPERS =====================

function titulo_(d) {
  const prefijo = d.estado === 'completed' ? '✓ ' : d.estado === 'no_show' ? 'No vino · ' : '';
  return prefijo + (d.paciente || 'Paciente') + ' · ' + (d.tratamiento || 'Turno');
}

function descripcion_(d) {
  const lineas = [];
  if (d.profesional) lineas.push('Médico/a: ' + d.profesional);
  if (d.telefono) lineas.push('Celular: +' + d.telefono);
  if (d.tratamiento) lineas.push('Tratamiento: ' + d.tratamiento);
  if (d.notas) lineas.push('Comentario: ' + d.notas);
  if (d.link) lineas.push('', 'Abrir en el CRM: ' + d.link);
  return lineas.join('\n');
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

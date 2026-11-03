/**
 * Puente CRM -> Google Sheets (Dr Beauty)
 *
 * El CRM manda un POST con JSON y este script agrega (o actualiza) una fila
 * en la planilla actual. Las columnas se asocian POR NOMBRE de encabezado,
 * así que no hace falta tocar la estructura de la planilla.
 *
 * Además de los campos de abajo, el CRM manda una clave por cada columna de la
 * planilla de Córdoba (Nombres, Apellidos, DNI (CUIL/CUIT), Tratamiento/s realizado/s,
 * Medico/a, Comentario, celular, mail, Domicilio, Medio de pago, Total, Comision medica,
 * Insumo, Ingreso Neto) y una por cada cuenta de cobro con su monto (Efectivo, Dolar,
 * GetNet Mariano, MP CHARI, TR Cuenta Franco, ...). La fecha va en la columna A.
 *
 * Ejemplo de JSON que manda el CRM:
 * {
 *   "token": "CAMBIAR-ESTE-TOKEN",
 *   "id_crm": "T-000123",
 *   "fecha": "2026-11-03",
 *   "paciente": "María Pérez",
 *   "telefono": "5491112345678",
 *   "tratamiento": "Botox tercio superior",
 *   "profesional": "Dra. Diana",
 *   "monto": 180000,
 *   "medio_de_pago": "Transferencia",
 *   "sucursal": "Palermo"
 * }
 *
 * "fecha_del_turno" coincide con el encabezado "Fecha del turno":
 * se ignoran mayúsculas, tildes, espacios y guiones bajos.
 */

// ===================== CONFIGURACIÓN =====================
const CONFIG = {
  TOKEN: 'CAMBIAR-ESTE-TOKEN',   // Clave secreta. Poné la misma en el CRM (Ajustes).
  SHEET_NAME: 'Turnos',          // Nombre exacto de la pestaña donde se cargan los turnos.
  HEADER_ROW: 1,                 // Fila donde están los encabezados.
  DATE_COLUMN: 1,                // Columna de la fecha aunque no tenga título (1 = A). 0 = no usar.
  ID_HEADER: 'ID CRM'            // Opcional: si existe una columna con este nombre, evita
                                 // duplicados y permite actualizar un turno ya cargado.
                                 // Si no existe, el script solo agrega filas nuevas y no
                                 // procesa ediciones (para no duplicar turnos).
};
// =========================================================


function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const data = parseBody_(e);

    const token = data.token || (e.parameter && e.parameter.token);
    if (token !== CONFIG.TOKEN) {
      return json_({ ok: false, error: 'Token inválido' });
    }
    delete data.token;

    lock.waitLock(20000); // evita que dos turnos simultáneos pisen la misma fila

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
    if (!sheet) {
      return json_({ ok: false, error: 'No existe la pestaña "' + CONFIG.SHEET_NAME + '"' });
    }

    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0];
    const headerKeys = headers.map(normalize_);

    // Mapear el JSON a las columnas de la planilla
    const payload = {};
    Object.keys(data).forEach(function (k) { payload[normalize_(k)] = data[k]; });

    const row = headerKeys.map(function (h) {
      return h && payload.hasOwnProperty(h) ? toCellValue_(payload[h]) : '';
    });

    // Fecha en una columna sin título (en la planilla de Córdoba, la A)
    const dateIdx = CONFIG.DATE_COLUMN - 1;
    if (dateIdx >= 0 && dateIdx < row.length && !headerKeys[dateIdx] && data.fecha) {
      row[dateIdx] = toCellValue_(data.fecha);
    }

    const unmatched = Object.keys(data).filter(function (k) {
      return headerKeys.indexOf(normalize_(k)) === -1;
    });

    // ¿Existe ya este turno? (solo si la planilla tiene la columna de ID)
    const idCol = headerKeys.indexOf(normalize_(CONFIG.ID_HEADER));
    if (idCol >= 0 && data.id_crm) row[idCol] = data.id_crm;
    const idValue = idCol >= 0 ? row[idCol] : '';
    let targetRow = -1;

    // Sin columna de ID no hay forma de encontrar la fila: las ediciones se ignoran
    if (idCol < 0 && data.evento === 'appointment.updated') {
      return json_({ ok: true, accion: 'ignorado', motivo: 'Edición sin columna ID CRM' });
    }

    if (idCol >= 0 && idValue !== '') {
      const firstDataRow = CONFIG.HEADER_ROW + 1;
      const numRows = sheet.getLastRow() - CONFIG.HEADER_ROW;
      if (numRows > 0) {
        const ids = sheet.getRange(firstDataRow, idCol + 1, numRows, 1).getValues();
        for (let i = 0; i < ids.length; i++) {
          if (String(ids[i][0]) === String(idValue)) {
            targetRow = firstDataRow + i;
            break;
          }
        }
      }
    }

    let action;
    if (targetRow > 0) {
      // Actualiza solo las celdas que vinieron en el JSON y respeta el resto
      const current = sheet.getRange(targetRow, 1, 1, lastCol).getValues()[0];
      const merged = current.map(function (val, i) {
        return payload.hasOwnProperty(headerKeys[i]) ? row[i] : val;
      });
      sheet.getRange(targetRow, 1, 1, lastCol).setValues([merged]);
      action = 'actualizado';
    } else {
      sheet.appendRow(row);
      targetRow = sheet.getLastRow();
      action = 'agregado';
    }

    return json_({ ok: true, accion: action, fila: targetRow, campos_sin_columna: unmatched });

  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    try { lock.releaseLock(); } catch (ignored) {}
  }
}


// Para comprobar desde el navegador que el script está publicado
function doGet() {
  return json_({ ok: true, mensaje: 'Puente CRM -> Sheets activo' });
}


// Prueba manual: ejecutala desde el editor de Apps Script (botón "Ejecutar")
function probarInsercion() {
  const fake = {
    postData: {
      contents: JSON.stringify({
        token: CONFIG.TOKEN,
        id_crm: 'TEST-001',
        evento: 'appointment.completed',
        fecha: '2026-11-03',
        'Nombres': 'Paciente',
        'Apellidos': 'De Prueba',
        'Tratamiento/s realizado/s': 'Botox (toxina botulínica) - Frente',
        'Medico/a': 'Dra. Prueba',
        'celular': '5491100000000',
        'Total': 1000,
        'Efectivo': 1000,
        'Medio de pago': 'Efectivo'
      })
    },
    parameter: {}
  };
  Logger.log(doPost(fake).getContent());
}


// ===================== HELPERS =====================

function parseBody_(e) {
  if (e && e.postData && e.postData.contents) {
    return JSON.parse(e.postData.contents);
  }
  // Alternativa: datos enviados como formulario
  return Object.assign({}, (e && e.parameter) || {});
}

// "Fecha del Turno" / "fecha_del_turno" / "FECHA-DEL-TURNO" -> "fechadelturno"
function normalize_(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// Convierte "2026-11-03" o "2026-11-03T15:30" en una fecha real de Sheets
function toCellValue_(v) {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?/.test(v)) {
    const parts = v.split(/[-T:]/).map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2], parts[3] || 0, parts[4] || 0, parts[5] || 0);
  }
  return v;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

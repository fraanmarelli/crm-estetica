// Lectura de la planilla de una sucursal (CSV bajado de Google Sheets) para «Importar historial».
// Corre en el navegador (vista previa) y no toca la base: arma las filas que después manda el servidor
// a import_sheet_rows(). Sin dependencias para poder probarlo con tsx.

export type ImportItem = { treatment: string; zone?: string; quantity?: number; price: number; lot?: string };
export type ImportPayment = { account: string; amount: number };
export type ImportRow = {
  ref: string;
  date: string; // AAAA-MM-DD
  first_name: string;
  last_name: string;
  dni: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  patient_key: string;
  professional: string | null;
  raw: string;
  comment: string | null;
  items: ImportItem[];
  payments: ImportPayment[];
  commission: number | null;
  supplies: number | null;
};
export type Skipped = { line: number; reason: string; sample: string };
export type ImportPreview = {
  rows: ImportRow[];
  skipped: Skipped[];
  total: number;
  patients: number;
  from: string | null;
  to: string | null;
  billed: number;
  byTreatment: [string, number][];
  unknown: [string, number][];
  professionals: [string, number][];
  missingHeaders: string[];
};

export const OTHER = "Otro (de la planilla)";
export const CONTROL = "Control";

// ---------------------------------------------------------------------
// CSV (comillas, comas y saltos de línea dentro de una celda)
// ---------------------------------------------------------------------
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out;
}

// ---------------------------------------------------------------------
// Ayudas
// ---------------------------------------------------------------------
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const titleCase = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());

// Plata como la escribe la planilla: «$48,000», « $5,800», «$1.234,50», «120 (euros)»
export function parseMoney(raw: string): number {
  const s = (raw ?? "").replace(/[^\d.,-]/g, "");
  if (!/\d/.test(s)) return 0;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    // El último separador es el decimal
    normalized = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    normalized = /,\d{3}$/.test(s) || (s.match(/,/g)?.length ?? 0) > 1 ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (lastDot >= 0) {
    normalized = /\.\d{3}$/.test(s) || (s.match(/\./g)?.length ?? 0) > 1 ? s.replace(/\./g, "") : s;
  } else normalized = s;
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

// «25/10/2022», «04/4//2025» (barra de más), «25/10/0202» (año dado vuelta) → AAAA-MM-DD
export function parseDate(raw: string): string | null {
  const s = (raw ?? "").trim().replace(/\/{2,}/g, "/");
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  let [, d, mo, y] = m;
  if (y === "0202") y = "2022";
  const day = Number(d);
  const month = Number(mo);
  const year = Number(y);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const check = new Date(`${iso}T12:00:00Z`);
  return check.getUTCDate() === day ? iso : null;
}

function cleanDni(raw: string): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length === 11) return d.slice(2, 10); // CUIT/CUIL → DNI
  return d.length >= 6 && d.length <= 9 ? d : null;
}
function cleanPhone(raw: string): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  return d.length >= 8 && d.length <= 15 ? d : null;
}
function cleanEmail(raw: string): string | null {
  const e = (raw ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

// Referencia estable de una fila (la misma fila da la misma referencia en cada corrida)
function hash(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------
// Tratamientos: del texto libre de la planilla a las opciones del catálogo
// ---------------------------------------------------------------------
type Hit = { find: RegExp; label: string; zone?: string; quantity?: number };

// Qué se nombra en un pedazo del texto («2 AH rinolips», «HT», «baby btx»)
function detect(part: string): Hit[] {
  const t = fold(part);
  const hits: Hit[] = [];
  // «Cons (se programó Botox, hilos y ácido)»: fue una consulta, lo demás es lo que se programó
  if (/^\(?cons(ulta|ula|uta)?\b/.test(t)) return [{ find: /^consulta/i, label: "Consulta" }];
  if (/\b(b+tx|botox|dy?s?port|dsyport|baby ?(b|d)|bbtx|toxina|babybtx)/.test(t)) hits.push({ find: /^botox/i, label: "Botox" });
  const ahQty = /(\d+)\s*ah\b|(\d+)ah\b/.exec(t);
  const quantity = ahQty ? Number(ahQty[1] ?? ahQty[2]) : undefined;
  const isAh = /(^|\W)\d*\s*ah\b|\dah\b|acido|hialur|harmonyca|hydroxyfill|rino|labio|ojera|surco|pomulo|menton|mandibul|fullface|full face/.test(t);
  if (isAh) {
    if (/rinolips/.test(t)) {
      hits.push({ find: /^rinomodel/i, label: "Rinomodelado" });
      hits.push({ find: /hialur.*labio/i, label: "Ácido hialurónico labios", zone: "Labios", quantity });
    } else if (/rino/.test(t)) hits.push({ find: /^rinomodel/i, label: "Rinomodelado", quantity });
    else if (/labio/.test(t)) hits.push({ find: /hialur.*labio/i, label: "Ácido hialurónico labios", zone: "Labios", quantity });
    else if (/surco/.test(t)) hits.push({ find: /hialur.*surco/i, label: "Ácido hialurónico surcos", zone: "Surcos nasogenianos", quantity });
    else if (/ojera/.test(t)) hits.push({ find: /hialur.*ojera/i, label: "Ácido hialurónico ojeras", zone: "Ojeras", quantity });
    else {
      const zone = /pomulo/.test(t)
        ? "Pómulos"
        : /menton/.test(t)
          ? "Mentón"
          : /mandibul/.test(t)
            ? "Mandíbula"
            : /full ?face/.test(t)
              ? "Full face"
              : /harmonyca/.test(t)
                ? "Harmonyca"
                : undefined;
      hits.push({ find: /hialur.*otras/i, label: "Ácido hialurónico", zone, quantity });
    }
  }
  if (/\b(ht|hilos?|htx\d*)\b|\bhtx/.test(t)) {
    if (/glute/.test(t)) hits.push({ find: /hilos.*glute/i, label: "Hilos glúteos" });
    else if (/abdom/.test(t)) hits.push({ find: /hilos.*abdom/i, label: "Hilos abdomen" });
    else hits.push({ find: /hilos.*facial/i, label: "Hilos tensores" });
  }
  if (/fox ?eyes/.test(t)) hits.push({ find: /^foxeyes/i, label: "FoxEyes" });
  if (/sculptra/.test(t)) hits.push({ find: /glute|corporal/.test(t) ? /sculptra corporal/i : /sculptra facial/i, label: "Sculptra" });
  if (/radiesse/.test(t)) hits.push({ find: /^radiesse/i, label: "Radiesse" });
  if (/profhilo/.test(t)) hits.push({ find: /^profhilo/i, label: "Profhilo" });
  if (/long ?lasting/.test(t)) hits.push({ find: /^long lasting/i, label: "Long Lasting" });
  if (/\bprp\b|plasma/.test(t)) hits.push({ find: /celulitis/.test(t) ? /plasma.*celulitis/i : /plaquetas/i, label: "Plasma" });
  if (/\bchip|pellet/.test(t)) hits.push({ find: /^chip/i, label: "Chip hormonal" });
  if (/\bmela\b/.test(t)) hits.push({ find: /^mela$/i, label: "MELA" });
  if (/\bhifu\b/.test(t)) hits.push({ find: /^hifu/i, label: "HIFU" });
  if (/laser|nordlys/.test(t)) hits.push({ find: /l[aá]ser/i, label: "Láser" });
  if (/scizer/.test(t)) hits.push({ find: /^scizer/i, label: "Scizer" });
  if (/\bcons(ulta|ula|uta)?\b/.test(t) && hits.length === 0) hits.push({ find: /^consulta/i, label: "Consulta" });
  return hits;
}

export function mapTreatments(raw: string, catalog: string[]): { items: Omit<ImportItem, "price">[]; recognized: boolean } {
  const resolve = (h: Hit): Omit<ImportItem, "price"> => {
    const name = catalog.find((c) => h.find.test(c));
    return name
      ? { treatment: name, zone: h.zone, quantity: h.quantity }
      : { treatment: OTHER, zone: h.zone ? `${h.label} (${h.zone})` : h.label, quantity: h.quantity };
  };
  const text = (raw ?? "").trim();
  if (!text) return { items: [{ treatment: OTHER }], recognized: false };

  const items: Omit<ImportItem, "price">[] = [];
  let recognized = true;
  for (const part of text.split(/\+|\s\/\s|;/)) {
    const p = part.trim();
    if (!p) continue;
    const hits = detect(p);
    if (/control|ctrl/.test(fold(p))) {
      items.push({ treatment: CONTROL, zone: hits.map((h) => h.label).join(", ") || undefined });
    } else if (hits.length) {
      items.push(...hits.map(resolve));
    } else {
      recognized = false;
      items.push({ treatment: OTHER, zone: titleCase(p).slice(0, 60) });
    }
  }
  if (items.length === 0) return { items: [{ treatment: OTHER, zone: text.slice(0, 60) }], recognized: false };
  if (items.some((i) => i.treatment === OTHER)) recognized = false;
  return { items, recognized };
}

// ---------------------------------------------------------------------
// La planilla entera
// ---------------------------------------------------------------------
const H = {
  first: ["nombres", "nombre"],
  last: ["apellidos", "apellido"],
  dni: ["dni (cuil/cuit)", "dni", "cuit"],
  treatment: ["tratamiento/s realizado/s", "tratamiento", "tratamientos"],
  professional: ["medico/a", "medico", "medica", "profesional"],
  comment: ["comentario"],
  lot: ["codigo/s producto/s", "codigo", "lote"],
  phone: ["celular", "telefono"],
  email: ["mail", "email"],
  address: ["domicilio", "direccion"],
  total: ["total"],
  commission: ["comision medica", "comision"],
  supplies: ["insumo", "insumos"],
};

export function buildImport(
  text: string,
  catalog: string[],
  accounts: { name: string; currency: string }[],
  today: string,
): ImportPreview {
  // Export de varias hojas: solo la primera («## Sheet name: Actual»); las demás se ignoran
  const firstSheet = text.replace(/^##[^\n]*\n/, "").split(/\n## Sheet name:[^\n]*\n/)[0];
  const all = parseCsv(firstSheet);
  const headerAt = all.findIndex((r) => r.some((c) => fold(c) === "nombres" || fold(c) === "nombre"));
  const header = (all[headerAt] ?? []).map(fold);
  const col = (names: string[]) => header.findIndex((h) => names.includes(h));
  const idx = Object.fromEntries(Object.entries(H).map(([k, v]) => [k, col(v)])) as Record<keyof typeof H, number>;
  const dateCol = header.findIndex((h) => h === "fecha" || h === "fecha del turno");
  const dateIdx = dateCol >= 0 ? dateCol : 0;
  const missingHeaders = (["first", "treatment", "total"] as const).filter((k) => idx[k] < 0);

  // Columnas de cobro: las que se llaman como una cuenta de la sucursal, y la de dólares
  const accountCols: { i: number; account: string }[] = [];
  header.forEach((h, i) => {
    if (!h) return;
    const acc = accounts.find((a) => fold(a.name) === h);
    if (acc) accountCols.push({ i, account: acc.currency === "USD" ? "__usd__" : acc.name });
    else if (/^dolar(es)?$|^usd$/.test(h)) accountCols.push({ i, account: "__usd__" });
  });

  // Médicos/as: los nombres que se repiten (en esa columna a veces hay notas, mails o teléfonos)
  const profCount = new Map<string, { name: string; n: number }>();
  const body = headerAt >= 0 ? all.slice(headerAt + 1) : [];
  for (const r of body) {
    const p = (r[idx.professional] ?? "").trim();
    if (!p || !/^[\p{L} .'-]{3,40}$/u.test(p)) continue;
    const k = fold(p);
    const cur = profCount.get(k) ?? { name: titleCase(p), n: 0 };
    cur.n++;
    profCount.set(k, cur);
  }

  const rows: ImportRow[] = [];
  const skipped: Skipped[] = [];
  const seen = new Map<string, number>();
  const patients = new Set<string>();
  const byTreatment = new Map<string, number>();
  const unknown = new Map<string, number>();
  const usedProfs = new Map<string, number>();
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");

  body.forEach((r, n) => {
    const line = headerAt + n + 2;
    if (!r.some((c) => c.trim())) return;
    const sample = r.slice(0, 6).map((c) => c.trim()).filter(Boolean).join(" | ").slice(0, 90);
    const first = cell(r, idx.first);
    if (fold(first) === "nombres" || fold(first) === "nombre") return; // encabezado repetido
    const date = parseDate(cell(r, dateIdx));
    if (!date) {
      skipped.push({ line, reason: "Sin fecha válida (la fila puede estar corrida)", sample });
      return;
    }
    if (date > today) {
      skipped.push({ line, reason: "Fecha futura", sample });
      return;
    }
    if (!first && !cell(r, idx.last)) {
      skipped.push({ line, reason: "Sin nombre", sample });
      return;
    }

    const raw = cell(r, idx.treatment);
    const { items: mapped, recognized } = mapTreatments(raw, catalog);
    if (!recognized && raw) unknown.set(fold(raw), (unknown.get(fold(raw)) ?? 0) + 1);

    const payments: ImportPayment[] = [];
    for (const c of accountCols) {
      const amount = parseMoney(cell(r, c.i));
      if (amount > 0 && !(c.account === "__usd__" && /euro/i.test(cell(r, c.i)))) payments.push({ account: c.account, amount });
    }
    const paidArs = payments.filter((p) => p.account !== "__usd__").reduce((s, p) => s + p.amount, 0);
    const total = parseMoney(cell(r, idx.total)) || paidArs;
    if (total > 0 && payments.length === 0) payments.push({ account: "__sin__", amount: total });

    // Precio: el total repartido entre lo que no es control (los controles van a $0)
    const paidItems = mapped.filter((i) => i.treatment !== CONTROL);
    const target = paidItems.length ? paidItems : mapped.slice(0, 1);
    const each = Math.floor((total / target.length) * 100) / 100;
    let rest = Math.round((total - each * target.length) * 100) / 100;
    const lot = cell(r, idx.lot).slice(0, 60) || undefined;
    const items: ImportItem[] = mapped.map((i, k) => {
      const priced = target.includes(i);
      const price = priced ? each + (rest > 0 && i === target[target.length - 1] ? rest : 0) : 0;
      if (priced && i === target[target.length - 1]) rest = 0;
      return { ...i, price: Math.round(price * 100) / 100, lot: k === 0 ? lot : undefined };
    });
    for (const i of items) byTreatment.set(i.treatment, (byTreatment.get(i.treatment) ?? 0) + 1);

    const dni = cleanDni(cell(r, idx.dni));
    const phone = cleanPhone(cell(r, idx.phone));
    const firstName = titleCase(first) || "Sin nombre";
    const lastName = titleCase(cell(r, idx.last));
    const patientKey = dni
      ? `sheet-dni:${dni}`
      : phone
        ? `sheet-tel:${phone}`
        : `sheet-nom:${fold(`${firstName} ${lastName}`)}`;
    patients.add(patientKey);

    const profRaw = cell(r, idx.professional);
    const prof = profCount.get(fold(profRaw));
    const professional = prof && prof.n >= 20 ? prof.name : null;
    if (professional) usedProfs.set(professional, (usedProfs.get(professional) ?? 0) + 1);
    const extraNote = profRaw && !professional ? `Médico/a en la planilla: ${profRaw}` : "";
    const comment = [cell(r, idx.comment), extraNote].filter(Boolean).join("\n") || null;

    const key = [date, fold(first), fold(lastName), dni ?? "", fold(raw), total, fold(cell(r, idx.comment))].join("|");
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);

    const commission = parseMoney(cell(r, idx.commission));
    const supplies = parseMoney(cell(r, idx.supplies));
    rows.push({
      ref: `sheet:${hash(`${key}|${occurrence}`)}`,
      date,
      first_name: firstName,
      last_name: lastName,
      dni,
      phone,
      email: cleanEmail(cell(r, idx.email)),
      address: cell(r, idx.address) || null,
      patient_key: patientKey,
      professional,
      raw: raw.slice(0, 500),
      comment,
      items,
      payments,
      commission: commission || null,
      supplies: supplies || null,
    });
  });

  const dates = rows.map((r) => r.date).sort();
  return {
    rows,
    skipped,
    total: body.length,
    patients: patients.size,
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
    billed: rows.reduce((s, r) => s + r.payments.filter((p) => p.account !== "__usd__").reduce((a, p) => a + p.amount, 0), 0),
    byTreatment: [...byTreatment.entries()].sort((a, b) => b[1] - a[1]),
    unknown: [...unknown.entries()].sort((a, b) => b[1] - a[1]),
    professionals: [...usedProfs.entries()].sort((a, b) => b[1] - a[1]),
    missingHeaders,
  };
}

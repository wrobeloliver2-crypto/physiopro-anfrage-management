// ====================================================================
// Datenbank-Zugriff (Neon Postgres) fuer die Anfragen
// --------------------------------------------------------------------
// Ersetzt das Google Sheet als Ablage. Wichtigster Unterschied zum alten
// sheets-api: Es wird nie mehr die ganze Tabelle geloescht und neu
// geschrieben, sondern nur die tatsaechlich geaenderten Karten.
//
// Aktiv, sobald DATABASE_URL gesetzt ist (pro Netlify-Kontext). Ohne
// DATABASE_URL arbeiten die Functions unveraendert mit dem Sheet weiter.
// ====================================================================
const { neon } = require('@neondatabase/serverless');

function dbAktiv() {
  return !!process.env.DATABASE_URL;
}

let _sql = null;
function sql() {
  if (!_sql) _sql = neon(process.env.DATABASE_URL);
  return _sql;
}

// Feld im Dashboard  ->  Spalte in der Datenbank
const FELDER = {
  id: 'id',
  eingangsdatum: 'eingangsdatum',
  quelle: 'quelle',
  name: 'name',
  telefon: 'telefon',
  email: 'email',
  anliegen: 'anliegen',
  prioritaet: 'prioritaet',
  status: 'status',
  bearbeiter: 'bearbeiter',
  followupDatum: 'followup_datum',
  followupZeit: 'followup_zeit',
  notizen: 'notizen',
  history: 'history',
  reminderStatus: 'reminder_status',
  __powerAppsId: 'power_apps_id',
  schritt: 'schritt',
  weitergeleitetAn: 'weitergeleitet_an',
  letzterReminder: 'letzter_reminder',
  ergebnis: 'ergebnis',
  utm_source: 'utm_source',
  utm_medium: 'utm_medium',
  utm_campaign: 'utm_campaign',
  utm_content: 'utm_content',
  gclid: 'gclid',
  standort: 'standort',
  klaerung: 'klaerung',
};
const JSON_FELDER = ['history', 'klaerung'];
const TEXT_SPALTEN = Object.entries(FELDER).filter(([k]) => !JSON_FELDER.includes(k)).map(([, s]) => s);

function alsArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (e) { return []; }
  }
  return [];
}

function alsObjektOderNull(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    try { const p = JSON.parse(v); return p && typeof p === 'object' && !Array.isArray(p) ? p : null; } catch (e) { return null; }
  }
  return null;
}

// Datenbank-Zeile -> Objekt im bisherigen Dashboard-Format
function zeileZuAnfrage(z) {
  const a = {};
  for (const [feld, spalte] of Object.entries(FELDER)) {
    const wert = z[spalte];
    if (feld === 'history') a.history = alsArray(wert);
    else if (feld === 'klaerung') a.klaerung = alsObjektOderNull(wert);
    else a[feld] = wert === null || wert === undefined ? '' : String(wert);
  }
  return a;
}

// Dashboard-Objekt -> flaches Objekt mit Spaltennamen (fuer jsonb_to_recordset)
function anfrageZuZeile(a) {
  const z = {};
  for (const [feld, spalte] of Object.entries(FELDER)) {
    const wert = a[feld];
    if (feld === 'history') z.history = alsArray(wert);
    else if (feld === 'klaerung') z.klaerung = alsObjektOderNull(wert);
    else z[spalte] = wert === null || wert === undefined ? '' : String(wert);
  }
  return z;
}

// ---- History zusammenfuehren ---------------------------------------
// Zwei Rechner koennen dieselbe Karte fast gleichzeitig aendern. Damit
// dabei kein Verlaufseintrag verloren geht, wird die History nie einfach
// ueberschrieben, sondern vereinigt (gleiche Eintraege nur einmal).
function eintragSchluessel(e) {
  if (!e || typeof e !== 'object') return JSON.stringify(e);
  return JSON.stringify([
    e.zeitstempel || '',
    e.aktion || e.feld || '',
    e.von || e.benutzer || '',
    e.details || e.wert || '',
  ]);
}

// autor: Name der angemeldeten Person. Neue Eintraege, die das Dashboard
// mitschickt, bekommen serverseitig genau diesen Namen als "von" – so ist
// der Verlauf belegbar und nicht frei waehlbar. "System"-Eintraege bleiben.
function historyVereinen(alt, neu, autor) {
  const ergebnis = [];
  const gesehen = new Set();
  const bekannt = new Set(alsArray(alt).map(eintragSchluessel));
  for (const roh of [...alsArray(alt), ...alsArray(neu)]) {
    const k = eintragSchluessel(roh);
    if (gesehen.has(k)) continue;
    gesehen.add(k);
    let e = roh;
    if (autor && !bekannt.has(k) && e && typeof e === 'object' && 'von' in e && e.von !== 'System') {
      e = { ...e, von: autor };
      const k2 = eintragSchluessel(e);
      if (gesehen.has(k2)) continue;
      gesehen.add(k2);
    }
    ergebnis.push(e);
  }
  // Stabil nach Zeit sortieren; Eintraege ohne lesbare Zeit bleiben an ihrer Stelle relativ
  return ergebnis
    .map((e, i) => ({ e, i, t: Date.parse((e && e.zeitstempel) || '') }))
    .sort((x, y) => {
      if (Number.isNaN(x.t) || Number.isNaN(y.t)) return x.i - y.i;
      return x.t - y.t || x.i - y.i;
    })
    .map((x) => x.e);
}

// ---- Gemeinsames Upsert -------------------------------------------
// optionen.klaerungUebernehmen: true nur bei Migration/Neuanlage. Im
// normalen Dashboard-Speichern bleibt die Klaerung unangetastet, sie
// wird ausschliesslich von klaerung-update geschrieben.
// optionen.historyErsetzen: true nur bei Migration (Sheet ist Quelle).
const SPALTENLISTE = [...TEXT_SPALTEN, 'history', 'klaerung'];
const RECORD_DEF = [...TEXT_SPALTEN.map((s) => s + ' text'), 'history jsonb', 'klaerung jsonb'].join(', ');

async function anfragenSpeichern(liste, optionen = {}) {
  const db = sql();
  if (!Array.isArray(liste) || !liste.length) return 0;

  const zeilen = liste.map(anfrageZuZeile).filter((z) => z.id);
  if (!zeilen.length) return 0;

  if (!optionen.historyErsetzen) {
    const ids = zeilen.map((z) => z.id);
    const bestehend = await db.query('SELECT id, history FROM anfragen WHERE id = ANY($1)', [ids]);
    const map = new Map(bestehend.map((r) => [r.id, r.history]));
    for (const z of zeilen) {
      z.history = historyVereinen(map.has(z.id) ? map.get(z.id) : [], z.history, optionen.autor);
    }
  }

  const updates = SPALTENLISTE
    .filter((s) => s !== 'id' && (s !== 'klaerung' || optionen.klaerungUebernehmen))
    .map((s) => `${s} = EXCLUDED.${s}`)
    .join(', ');

  const text = `
    INSERT INTO anfragen (${SPALTENLISTE.join(', ')})
    SELECT ${SPALTENLISTE.map((s) => (s === 'history' ? "COALESCE(x.history, '[]'::jsonb)" : (s === 'klaerung' ? 'x.klaerung' : `COALESCE(x.${s}, '')`))).join(', ')}
    FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS e(obj, nr)
    CROSS JOIN LATERAL jsonb_to_record(e.obj) AS x(${RECORD_DEF})
    ORDER BY e.nr
    ON CONFLICT (id) DO UPDATE SET ${updates}, geaendert_am = now()`;
  await db.query(text, [JSON.stringify(zeilen)]);
  return zeilen.length;
}

async function anfragenLaden() {
  const zeilen = await sql().query('SELECT * FROM anfragen ORDER BY reihenfolge');
  return zeilen.map(zeileZuAnfrage);
}

async function anfragenLoeschen(ids) {
  if (!Array.isArray(ids) || !ids.length) return 0;
  const r = await sql().query('DELETE FROM anfragen WHERE id = ANY($1) RETURNING id', [ids.map(String)]);
  return r.length;
}

module.exports = {
  dbAktiv, sql, FELDER, zeileZuAnfrage, anfrageZuZeile, historyVereinen,
  anfragenSpeichern, anfragenLaden, anfragenLoeschen, alsArray,
};

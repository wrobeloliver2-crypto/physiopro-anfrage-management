// ====================================================================
// Netlify Function: migrate-sheet  (EINMALIG / nur zur Umstellung)
// Uebernimmt alle Karten aus dem Google Sheet (GOOGLE_SHEET_ID des
// jeweiligen Kontexts) und die Uebergabe-Notizen in die Datenbank.
//
//   GET ?key=<MIGRATION_KEY>&dry=1   -> nur zaehlen, nichts schreiben
//   GET ?key=<MIGRATION_KEY>         -> uebernehmen (wiederholbar:
//                                       vorhandene ids werden mit dem
//                                       Sheet-Stand ueberschrieben)
//
// Ohne gesetztes MIGRATION_KEY ist die Function abgeschaltet. Nach der
// Umstellung MIGRATION_KEY entfernen und diese Datei loeschen.
// ====================================================================
const { google } = require('googleapis');
const crypto = require('crypto');
const { dbAktiv, sql, anfragenSpeichern, alsArray } = require('../lib/anfragen-db.cjs');

const COLUMNS = [
  'id', 'eingangsdatum', 'quelle', 'name', 'telefon', 'email', 'anliegen', 'prioritaet',
  'status', 'bearbeiter', 'followupDatum', 'followupZeit', 'notizen', 'history',
  'reminderStatus', '__powerAppsId', 'schritt', 'weitergeleitetAn', 'letzterReminder',
  'ergebnis', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'gclid',
  'standort', 'klaerung',
];
const NOTIZ_COLUMNS = ['id', 'text', 'autor', 'zeit'];
const NOTES_SHEET_ID = process.env.GOOGLE_NOTES_SHEET_ID || '1oCUHh8cN8XWGUAu-ESeFQErAL08aG9HEnkaXEZqycVg';

const antwort = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body, null, 2),
});

function sheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}');
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  return google.sheets({ version: 'v4', auth });
}

async function ersterTab(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
  return (meta.data.sheets && meta.data.sheets[0] && meta.data.sheets[0].properties.title) || 'Tabelle1';
}

function keyGleich(a, b) {
  const x = Buffer.from(String(a || '')); const y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

exports.handler = async (event) => {
  const soll = process.env.MIGRATION_KEY;
  if (!soll) return antwort(404, { success: false, error: 'Nicht aktiv' });
  const q = event.queryStringParameters || {};
  if (!keyGleich(q.key, soll)) return antwort(401, { success: false, error: 'Unauthorized' });
  if (!dbAktiv()) return antwort(500, { success: false, error: 'DATABASE_URL fehlt' });
  if (!process.env.GOOGLE_SHEET_ID) return antwort(500, { success: false, error: 'GOOGLE_SHEET_ID fehlt' });
  const trocken = q.dry === '1';

  try {
    const sheets = sheetsClient();

    // ---- Anfragen ----
    const tab = await ersterTab(sheets, process.env.GOOGLE_SHEET_ID);
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: tab + '!A2:AA5000' });
    const zeilen = (res.data.values || []).filter((r) => r && r.length && String(r[0] || '').trim());
    const gesehen = new Map();
    const doppelt = [];
    const karten = zeilen.map((r) => {
      const a = {};
      COLUMNS.forEach((k, i) => { a[k] = r[i] !== undefined ? r[i] : ''; });
      a.id = String(a.id).trim();
      a.history = alsArray(a.history);
      // Doppelte ids (kam im Sheet vereinzelt vor) eindeutig machen statt zu verlieren
      const n = (gesehen.get(a.id) || 0) + 1;
      gesehen.set(a.id, n);
      if (n > 1) { doppelt.push(a.id); a.id = a.id + '~' + n; }
      return a;
    });

    // ---- Notizen ----
    let notizen = [];
    try {
      const nTab = await ersterTab(sheets, NOTES_SHEET_ID);
      const nRes = await sheets.spreadsheets.values.get({ spreadsheetId: NOTES_SHEET_ID, range: nTab + '!A2:D1000' });
      notizen = (nRes.data.values || []).filter((r) => r && r[0]).map((r) => {
        const o = {}; NOTIZ_COLUMNS.forEach((k, i) => { o[k] = r[i] !== undefined ? String(r[i]) : ''; }); return o;
      });
    } catch (e) {
      console.error('Notizen nicht lesbar:', e.message);
    }

    const bericht = {
      success: true,
      trocken,
      sheet: process.env.GOOGLE_SHEET_ID.slice(0, 6) + '…',
      kartenImSheet: karten.length,
      doppelteIdsUmbenannt: doppelt,
      notizenImSheet: notizen.length,
    };
    if (trocken) return antwort(200, bericht);

    // in Paketen schreiben (Request-Groesse klein halten)
    let geschrieben = 0;
    for (let i = 0; i < karten.length; i += 150) {
      geschrieben += await anfragenSpeichern(karten.slice(i, i + 150), { historyErsetzen: true, klaerungUebernehmen: true });
    }
    if (notizen.length) {
      await sql().query(
        `INSERT INTO uebergabe_notizen (id, text, autor, zeit)
         SELECT x.id, COALESCE(x.text,''), COALESCE(x.autor,''), COALESCE(x.zeit,'')
         FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS e(obj, nr)
         CROSS JOIN LATERAL jsonb_to_record(e.obj) AS x(id text, text text, autor text, zeit text)
         ORDER BY e.nr
         ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text, autor = EXCLUDED.autor, zeit = EXCLUDED.zeit`,
        [JSON.stringify(notizen)]
      );
    }
    const zaehlung = await sql().query('SELECT (SELECT count(*) FROM anfragen)::int AS anfragen, (SELECT count(*) FROM uebergabe_notizen)::int AS notizen');
    return antwort(200, { ...bericht, kartenGeschrieben: geschrieben, inDatenbank: zaehlung[0] });
  } catch (err) {
    console.error('migrate-sheet Fehler:', err);
    return antwort(500, { success: false, error: err.message || 'unbekannt' });
  }
};

// ====================================================================
// Netlify Function: notes-api
// Uebergabe-Notizen fuer das Rezeptionsdashboard
// Eigenes Google Sheet (separat vom Anfrage-Sheet)
// ====================================================================
const { google } = require('googleapis');
const { zugriffPruefen, CORS_HEADERS } = require('../lib/auth.cjs');
const { dbAktiv, sql } = require('../lib/anfragen-db.cjs');

// Eigenes Notizen-Sheet; ueber ENV ueberschreibbar
const NOTES_SHEET_ID =
  process.env.GOOGLE_NOTES_SHEET_ID || '1oCUHh8cN8XWGUAu-ESeFQErAL08aG9HEnkaXEZqycVg';
const COLUMNS = ['id', 'text', 'autor', 'zeit'];

function getSheets() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// Ersten Tab-Namen ermitteln (robust gegen "Tabellenblatt1" vs "Sheet1")
async function ersterTabName(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
  const titel = meta.data.sheets && meta.data.sheets[0] && meta.data.sheets[0].properties.title;
  return titel || 'Tabelle1';
}

const rowToObject = (row) => {
  const o = {};
  COLUMNS.forEach((k, i) => { o[k] = row[i] !== undefined ? row[i] : ''; });
  return o;
};
const objectToRow = (n) => COLUMNS.map((k) => (n[k] !== undefined && n[k] !== null ? String(n[k]) : ''));

const jsonResponse = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    ...CORS_HEADERS,
  },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(200, { success: true });

  // Mit Datenbank (DATABASE_URL gesetzt): Zugriff nur mit Token, Notizen in Postgres.
  if (dbAktiv()) {
    const verweigert = zugriffPruefen(event);
    if (verweigert) return verweigert;
    try {
      if (event.httpMethod === 'GET') {
        const data = await sql().query('SELECT id, text, autor, zeit FROM uebergabe_notizen ORDER BY reihenfolge');
        return jsonResponse(200, { success: true, data });
      }
      if (event.httpMethod === 'POST') {
        const payload = JSON.parse(event.body || '{}');
        const notizen = (Array.isArray(payload.notizen) ? payload.notizen : [])
          .filter((n) => n && n.id)
          .map((n) => ({ id: String(n.id), text: String(n.text || ''), autor: String(n.autor || ''), zeit: String(n.zeit || '') }));
        const db = sql();
        await db.transaction([
          db.query('DELETE FROM uebergabe_notizen WHERE NOT (id = ANY($1))', [notizen.map((n) => n.id)]),
          db.query(
            `INSERT INTO uebergabe_notizen (id, text, autor, zeit)
             SELECT x.id, x.text, x.autor, x.zeit
             FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS e(obj, nr)
         CROSS JOIN LATERAL jsonb_to_record(e.obj) AS x(id text, text text, autor text, zeit text)
             ORDER BY e.nr
             ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text, autor = EXCLUDED.autor, zeit = EXCLUDED.zeit`,
            [JSON.stringify(notizen)]
          ),
        ]);
        return jsonResponse(200, { success: true, message: notizen.length + ' notes updated' });
      }
      return jsonResponse(405, { success: false, error: 'Method not allowed' });
    } catch (err) {
      console.error('notes-api DB Fehler:', err);
      return jsonResponse(500, { success: false, error: 'Datenbankfehler: ' + (err.message || 'unbekannt') });
    }
  }

  if (!process.env.GOOGLE_SERVICE_ACCOUNT) {
    return jsonResponse(500, { success: false, error: 'Server nicht konfiguriert' });
  }

  try {
    const sheets = getSheets();
    const tab = await ersterTabName(sheets, NOTES_SHEET_ID);
    const range = tab + '!A2:D1000';

    if (event.httpMethod === 'GET') {
      const res = await sheets.spreadsheets.values.get({ spreadsheetId: NOTES_SHEET_ID, range });
      const rows = res.data.values || [];
      const data = rows.filter((r) => r && r.length > 0 && r[0]).map(rowToObject);
      return jsonResponse(200, { success: true, data });
    }

    if (event.httpMethod === 'POST') {
      const payload = JSON.parse(event.body || '{}');
      const notizen = Array.isArray(payload.notizen) ? payload.notizen : [];
      const values = notizen.map(objectToRow);
      await sheets.spreadsheets.values.clear({ spreadsheetId: NOTES_SHEET_ID, range });
      if (values.length > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: NOTES_SHEET_ID, range: tab + '!A2',
          valueInputOption: 'USER_ENTERED', requestBody: { values },
        });
      }
      return jsonResponse(200, { success: true, message: values.length + ' notes updated' });
    }

    return jsonResponse(405, { success: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('Notes API Error:', err);
    const code = err.code === 403 ? 403 : err.code === 429 ? 429 : 500;
    return jsonResponse(code, { success: false, error: 'Google Sheets API error: ' + (err.message || 'unknown') });
  }
};

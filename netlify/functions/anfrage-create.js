// ====================================================================
// Netlify Function: anfrage-create
// Eigenständiger Schreib-Endpunkt für Power Automate Flow #1.
//
// Zweck: Flow #1 (Mail → Sheet) ruft NUR diese Function per HTTP auf,
// statt selbst über den Google-Connector zu schreiben. Damit läuft das
// Schreiben über die SERVICE-ACCOUNT-Identität (eigener 60/min-"per user"-
// Eimer) und konkurriert nicht mehr mit dem Lesen (Weiterleitungs-Flow +
// Dashboard) um dasselbe Google-Rate-Limit.
//
// Schreibt GENAU EINE Zeile via values.append (ein einziger API-Call,
// kein Lesen, kein clear/rewrite des ganzen Sheets).
//
// Absicherung: Header x-api-key muss FLOW_API_KEY (Netlify-ENV) entsprechen.
// ====================================================================
const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const FLOW_API_KEY = process.env.FLOW_API_KEY;

// Spalten-Reihenfolge MUSS exakt dem Sheet-Schema A..T entsprechen.
// P (__powerAppsId) bleibt beim Anhängen leer — der Google-Connector des
// Weiterleitungs-Flows verwaltet/befüllt diese Spalte selbst.
// S (letzterReminder) und T (ergebnis) bleiben bei Neuanlage leer.
const COLUMNS = [
  'id',             // A
  'eingangsdatum',  // B
  'quelle',         // C
  'name',           // D
  'telefon',        // E
  'email',          // F
  'anliegen',       // G
  'prioritaet',     // H
  'status',         // I
  'bearbeiter',     // J
  'followupDatum',  // K
  'followupZeit',   // L
  'notizen',        // M
  'history',        // N
  'reminderStatus', // O
  '__powerAppsId',  // P  (leer lassen)
  'schritt',        // Q
  'weitergeleitetAn', // R
  'letzterReminder',  // S  (leer lassen)
  'ergebnis',         // T  (leer lassen)
  'utm_source',       // U
  'utm_medium',       // V
  'utm_campaign',     // W
  'utm_content',      // X
  'gclid',            // Y
];

// ---- Telefon-Normalisierung (IDENTISCH zum Dashboard / App.jsx) ----
function normalizeTelefon(roh) {
  if (!roh) return '';
  let n = String(roh).trim();
  const hatPlus = n.startsWith('+');
  n = n.replace(/[^0-9]/g, '');
  if (!n) return '';
  if (n.startsWith('00')) n = n.slice(2);
  if (n.startsWith('49')) return '+' + n;
  if (n.startsWith('0')) return '+49' + n.slice(1);
  if (n.startsWith('1') || hatPlus) return '+49' + n;
  return '+' + n;
}

// ---- Auth (Service Account) ----
function getSheets() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function ersterTabName(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties.title',
  });
  const titel = meta.data.sheets && meta.data.sheets[0] && meta.data.sheets[0].properties.title;
  return titel || 'Tabelle1';
}

const jsonResponse = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
  },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(200, { success: true });
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { success: false, error: 'Method not allowed' });
  }

  // ---- Absicherung: Token prüfen ----
  if (!FLOW_API_KEY) {
    return jsonResponse(500, { success: false, error: 'Server nicht konfiguriert (FLOW_API_KEY fehlt)' });
  }
  const key = event.headers['x-api-key'] || event.headers['X-Api-Key'];
  if (key !== FLOW_API_KEY) {
    return jsonResponse(401, { success: false, error: 'Unauthorized' });
  }

  if (!SHEET_ID || !process.env.GOOGLE_SERVICE_ACCOUNT) {
    return jsonResponse(500, { success: false, error: 'Server nicht konfiguriert (Sheet/Service-Account fehlt)' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return jsonResponse(400, { success: false, error: 'Ungültiges JSON' });
  }

  // ---- Pflichtfeld-Minimalprüfung ----
  if (!payload.name && !payload.telefon && !payload.anliegen) {
    return jsonResponse(400, {
      success: false,
      error: 'Mindestens Name, Telefon oder Anliegen erforderlich',
    });
  }

  // ---- Zeile aufbauen ----
  // History: akzeptiert fertiges JSON-String oder Array; sonst Standardeintrag.
  let historyStr;
  if (typeof payload.history === 'string' && payload.history.trim()) {
    historyStr = payload.history;
  } else if (Array.isArray(payload.history)) {
    historyStr = JSON.stringify(payload.history);
  } else {
    historyStr = JSON.stringify([{
      zeitstempel: new Date().toISOString(),
      feld: 'Erstellt',
      benutzer: 'Flow #1',
      wert: payload.quelle || 'E-Mail-Eingang',
    }]);
  }

  const obj = {
    id: payload.id || ('mail-' + Date.now()),
    eingangsdatum: payload.eingangsdatum || new Date().toISOString().slice(0, 10),
    quelle: payload.quelle || 'Website',
    name: payload.name || '',
    telefon: normalizeTelefon(payload.telefon),
    email: payload.email || '',
    anliegen: payload.anliegen || '',
    prioritaet: payload.prioritaet || 'Normal',
    status: 'Offen',           // immer Offen bei Neuanlage
    bearbeiter: 'Unzugewiesen', // immer Unzugewiesen bei Neuanlage
    followupDatum: payload.followupDatum || '',
    followupZeit: payload.followupZeit || '',
    notizen: payload.notizen || '',
    history: historyStr,
    reminderStatus: '',
    __powerAppsId: '',   // vom Connector verwaltet
    schritt: '',
    weitergeleitetAn: '',
    letzterReminder: '', // S leer
    ergebnis: '',        // T leer
    utm_source:   payload.utm_source   || '', // U
    utm_medium:   payload.utm_medium   || '', // V
    utm_campaign: payload.utm_campaign || '', // W
    utm_content:  payload.utm_content  || '', // X
    gclid:        payload.gclid        || '', // Y
  };

  const row = COLUMNS.map((k) => (obj[k] !== undefined && obj[k] !== null ? String(obj[k]) : ''));

  // ---- Schreiben: GENAU EINE Zeile anhängen (append, kein clear/rewrite) ----
  try {
    const sheets = getSheets();
    const tab = await ersterTabName(sheets, SHEET_ID);

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: tab + '!A2',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });

    return jsonResponse(200, {
      success: true,
      message: 'Anfrage angelegt',
      id: obj.id,
      telefon: obj.telefon,
    });
  } catch (err) {
    console.error('anfrage-create Fehler:', err);
    const code = err.code === 403 ? 403 : err.code === 429 ? 429 : 500;
    return jsonResponse(code, {
      success: false,
      error: 'Google Sheets API error: ' + (err.message || 'unknown'),
    });
  }
};

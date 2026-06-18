// ====================================================================
// Netlify Function: sheets-api
// Google Sheets API v4 (Service Account) - GET (Read) & POST (Write)
// PhysioPro Anfrage-Management
// ====================================================================
const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const RANGE = 'Sheet1!A2:O1000';

// Spalten-Reihenfolge entspricht dem Sheet-Schema A..O
const COLUMNS = [
  'id',
  'eingangsdatum',
  'quelle',
  'name',
  'telefon',
  'email',
  'anliegen',
  'prioritaet',
  'status',
  'bearbeiter',
  'followupDatum',
  'followupZeit',
  'notizen',
  'history',
  'reminderStatus',
];

// ---- Auth (Service Account) ----
function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}');
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function getSheets() {
  const auth = getAuth();
  return google.sheets({ version: 'v4', auth });
}

// ---- Zeile (Array) -> Objekt ----
function rowToObject(row) {
  const obj = {};
  COLUMNS.forEach((key, i) => {
    obj[key] = row[i] !== undefined ? row[i] : '';
  });
  // History als JSON parsen
  try {
    obj.history = obj.history ? JSON.parse(obj.history) : [];
  } catch (e) {
    obj.history = [];
  }
  return obj;
}

// ---- Objekt -> Zeile (Array) ----
function objectToRow(a) {
  return COLUMNS.map((key) => {
    if (key === 'history') {
      return JSON.stringify(a.history || []);
    }
    return a[key] !== undefined && a[key] !== null ? String(a[key]) : '';
  });
}

const jsonResponse = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  // CORS Preflight
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(200, { success: true });
  }

  if (!SHEET_ID || !process.env.GOOGLE_SERVICE_ACCOUNT) {
    return jsonResponse(500, {
      success: false,
      error: 'Server nicht konfiguriert (GOOGLE_SHEET_ID / GOOGLE_SERVICE_ACCOUNT fehlt)',
    });
  }

  try {
    const sheets = getSheets();

    // -------------------- READ --------------------
    if (event.httpMethod === 'GET') {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: RANGE,
      });
      const rows = res.data.values || [];
      const data = rows
        .filter((r) => r && r.length > 0 && r[0])
        .map(rowToObject);
      return jsonResponse(200, { success: true, data });
    }

    // -------------------- WRITE --------------------
    if (event.httpMethod === 'POST') {
      const payload = JSON.parse(event.body || '{}');
      const anfragen = Array.isArray(payload.anfragen) ? payload.anfragen : [];
      const values = anfragen.map(objectToRow);

      // Erst Datenbereich leeren, dann komplette Liste schreiben
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SHEET_ID,
        range: RANGE,
      });

      if (values.length > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: 'Sheet1!A2',
          valueInputOption: 'USER_ENTERED',
          requestBody: { values },
        });
      }

      return jsonResponse(200, {
        success: true,
        message: values.length + ' rows updated',
      });
    }

    return jsonResponse(405, { success: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('Sheet API Error:', err);
    const code = err.code === 403 ? 403 : err.code === 429 ? 429 : 500;
    return jsonResponse(code, {
      success: false,
      error: 'Google Sheets API error: ' + (err.message || 'unknown'),
    });
  }
};

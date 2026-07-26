// ====================================================================
// Netlify Function: bad-schwartau-anfrage-create
// Schreib-Endpunkt fuer das Terminanfrage-Formular Bad Schwartau
// (physiopro-website, bad-schwartau/termin.html).
//
// Zweck: Nimmt JEDE Terminanfrage aus Bad Schwartau entgegen und legt sie
// als Karte im Anfragen-Sheet an, inkl. explizitem Ja/Nein-Status der
// DSGVO-Einwilligung zur Datenanforderung bei der Insolvenzverwalterin
// (Frau Beate Thompson, Kanzlei Dr. Moeller-Thompson-Kruse). So ist die
// Einwilligung auch im Lead-Management-Dashboard sichtbar - unabhaengig
// vom separaten Kruse-Consent-Log-Sheet (kruse-consent-log.js), das nur
// positive Einwilligungen fuer die Kanzlei-Uebermittlung protokolliert.
//
// Kein FLOW_API_KEY-Schutz: wird direkt aus dem oeffentlichen Formular im
// Browser aufgerufen (wie kruse-consent-log.js), daher CORS offen (*).
// ====================================================================
const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

// Spalten-Reihenfolge MUSS exakt dem Sheet-Schema A..Z entsprechen (siehe anfrage-create.js).
const COLUMNS = [
  'id',               // A
  'eingangsdatum',    // B
  'quelle',           // C
  'name',             // D
  'telefon',          // E
  'email',            // F
  'anliegen',         // G
  'prioritaet',       // H
  'status',           // I
  'bearbeiter',       // J
  'followupDatum',    // K
  'followupZeit',     // L
  'notizen',          // M
  'history',          // N
  'reminderStatus',   // O
  '__powerAppsId',    // P  (leer lassen)
  'schritt',          // Q
  'weitergeleitetAn', // R
  'letzterReminder',  // S  (leer lassen)
  'ergebnis',         // T  (leer lassen)
  'utm_source',       // U
  'utm_medium',       // V
  'utm_campaign',     // W
  'utm_content',      // X
  'gclid',            // Y
  'dsgvoEinwilligungKruse', // Z
];

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
    'Access-Control-Allow-Headers': 'Content-Type',
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
  if (!SHEET_ID || !process.env.GOOGLE_SERVICE_ACCOUNT) {
    return jsonResponse(500, { success: false, error: 'Server nicht konfiguriert (Sheet/Service-Account fehlt)' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return jsonResponse(400, { success: false, error: 'Ungueltiges JSON' });
  }

  const name = String(payload.name || '').trim();
  const telefon = String(payload.telefon || '').trim();
  if (!name || !telefon) {
    return jsonResponse(400, { success: false, error: 'Name und Telefon erforderlich' });
  }

  // ---- DSGVO-Einwilligung normalisieren: nur 'Ja' oder 'Nein', sonst leer (nicht zutreffend) ----
  const consentRaw = payload.dsgvoEinwilligungKruse;
  let dsgvoEinwilligungKruse = '';
  if (consentRaw === true || consentRaw === 'Ja' || consentRaw === 'ja') dsgvoEinwilligungKruse = 'Ja';
  else if (consentRaw === false || consentRaw === 'Nein' || consentRaw === 'nein') dsgvoEinwilligungKruse = 'Nein';

  // ---- Anliegen-Text zusammensetzen (Rezeptstatus, Geburtsdatum, Hinweis) ----
  const rezeptStatus = payload.rezeptStatus || '';
  const rezeptTxt = rezeptStatus === 'laufend'
    ? 'Rezept laeuft bereits in Bad Schwartau'
    : (rezeptStatus === 'neu' ? 'Plant neues Rezept' : '');
  const geburtsdatum = String(payload.geburtsdatum || '').trim();
  const hinweis = String(payload.hinweis || '').trim();
  const teile = [
    'Standort: Bad Schwartau (Eutiner Ring 4A)',
    rezeptTxt,
    geburtsdatum ? 'Geburtsdatum: ' + geburtsdatum : '',
    dsgvoEinwilligungKruse ? 'Einwilligung Datenanforderung bei Frau Thompson: ' + dsgvoEinwilligungKruse : '',
    hinweis,
  ].filter(Boolean);
  const anliegen = teile.join(' | ');

  const jetzt = new Date().toISOString();
  const historyArr = [{
    zeitstempel: jetzt,
    feld: 'Erstellt',
    benutzer: 'Bad Schwartau Formular',
    wert: 'Website',
  }];

  const obj = {
    id: 'bs-' + Date.now(),
    eingangsdatum: jetzt.slice(0, 10),
    quelle: 'Bad Schwartau',
    name,
    telefon,
    email: String(payload.email || '').trim(),
    anliegen,
    prioritaet: 'Normal',
    status: 'Offen',
    bearbeiter: 'Unzugewiesen',
    followupDatum: '',
    followupZeit: '',
    notizen: '',
    history: JSON.stringify(historyArr),
    reminderStatus: '',
    __powerAppsId: '',
    schritt: '',
    weitergeleitetAn: '',
    letzterReminder: '',
    ergebnis: '',
    utm_source: payload.utm_source || '',
    utm_medium: payload.utm_medium || '',
    utm_campaign: payload.utm_campaign || '',
    utm_content: payload.utm_content || '',
    gclid: payload.gclid || '',
    dsgvoEinwilligungKruse,
  };

  const row = COLUMNS.map((k) => (obj[k] !== undefined && obj[k] !== null ? String(obj[k]) : ''));

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

    return jsonResponse(200, { success: true, message: 'Anfrage angelegt', id: obj.id });
  } catch (err) {
    console.error('bad-schwartau-anfrage-create Fehler:', err);
    const code = err.code === 403 ? 403 : err.code === 429 ? 429 : 500;
    return jsonResponse(code, { success: false, error: 'Google Sheets API error: ' + (err.message || 'unknown') });
  }
};

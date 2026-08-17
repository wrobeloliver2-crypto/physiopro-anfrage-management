// ====================================================================
// Netlify Function: sheets-api
// Google Sheets API v4 (Service Account) - GET (Read) & POST (Write)
// PhysioPro Anfrage-Management
// ====================================================================
const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
// Tab-Name wird dynamisch ermittelt (robust gegen 'Tabellenblatt1' vs 'Sheet1')

// Spalten-Reihenfolge entspricht dem Sheet-Schema A..AA
// P (__PowerAppsId__) wird vom Google-Connector verwaltet und transparent durchgereicht.
// Z  (standort) und AA (klaerung) sind am 17.08.2026 ergänzt worden:
//   - standort: expliziter Standort der Karte ('bad-schwartau' | 'stockelsdorf').
//     Vorher wurde der Standort ausschliesslich aus dem Anliegen-Text bzw.
//     utm_campaign geraten (istBadSchwartauAnfrage in src/App.jsx). Diese Text-
//     Erkennung bleibt als Fallback erhalten, damit Altzeilen und alle
//     automatischen Wege unveraendert korrekt einsortiert werden.
//     ACHTUNG: Spalte Z trug bis zur Kruse-Entfernung die DSGVO-Einwilligung
//     ("Ja"/"Nein"). Reste davon werden bewusst ignoriert — das Frontend
//     akzeptiert nur die beiden bekannten Standort-Slugs, alles andere gilt als
//     leer und wird beim naechsten vollen Speichern ueberschrieben.
//   - klaerung: JSON der Standort-Rueckfrage ({von,an,status,verlauf}) oder leer.
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
  '__powerAppsId',
  'schritt',
  'weitergeleitetAn',
  'letzterReminder',
  'ergebnis',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'gclid',
  'standort',
  'klaerung',
];

// Sheet-Raster muss bis Spalte AA reichen (27 Spalten). Ein frisches Google
// Sheet hat 26 (A..Z) — fehlt Platz, wird er beim ersten Lesen automatisch
// angelegt, damit niemand die Spalten manuell nachziehen muss.
const SPALTEN_ANZAHL = 27;
const LETZTE_SPALTE = 'AA';
const KOPFZEILEN = { 25: 'Standort', 26: 'Klärung' }; // Index -> Header-Text (Z, AA)
// Nur einmal pro Function-Instanz nachziehen (kein Schreib-Call pro Request).
let kopfzeilenGeprueft = false;

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

// Ersten Tab-Namen ermitteln (robust gegen Sprach-/Namensunterschiede) und
// dabei sicherstellen, dass das Raster bis Spalte AA reicht. Das Verbreitern
// ist idempotent: es passiert nur, wenn wirklich Spalten fehlen.
async function ersterTabName(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties(sheetId,title,gridProperties)',
  });
  const props = (meta.data.sheets && meta.data.sheets[0] && meta.data.sheets[0].properties) || {};
  const titel = props.title || 'Tabelle1';
  const spalten = (props.gridProperties && props.gridProperties.columnCount) || 0;
  if (props.sheetId !== undefined && spalten > 0 && spalten < SPALTEN_ANZAHL) {
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            appendDimension: {
              sheetId: props.sheetId,
              dimension: 'COLUMNS',
              length: SPALTEN_ANZAHL - spalten,
            },
          }],
        },
      });
    } catch (e) {
      // Nicht fatal: das Lesen/Schreiben scheitert dann sichtbar mit einer
      // klaren Google-Fehlermeldung, statt hier still zu bleiben.
      console.error('Spalten konnten nicht ergaenzt werden:', e && e.message);
    }
  }
  return titel;
}

// Header-Texte fuer die beiden neuen Spalten nachziehen, falls leer. Nur
// einmal pro Function-Instanz und nur, wenn wirklich etwas fehlt.
async function kopfzeilenSicherstellen(sheets, tab, header) {
  if (kopfzeilenGeprueft) return;
  kopfzeilenGeprueft = true;
  const daten = Object.entries(KOPFZEILEN)
    .filter(([idx]) => !String((header || [])[Number(idx)] || '').trim())
    .map(([idx, text]) => ({
      range: tab + '!' + (Number(idx) === 25 ? 'Z' : 'AA') + '1',
      values: [[text]],
    }));
  if (!daten.length) return;
  try {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { valueInputOption: 'USER_ENTERED', data: daten },
    });
  } catch (e) {
    console.error('Kopfzeilen konnten nicht gesetzt werden:', e && e.message);
  }
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
  // Klaerung (Standort-Rueckfrage) als JSON parsen, leer => null
  try {
    const roh = obj.klaerung;
    const parsed = roh ? JSON.parse(roh) : null;
    obj.klaerung = parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    obj.klaerung = null;
  }
  return obj;
}

// ---- Objekt -> Zeile (Array) ----
function objectToRow(a) {
  return COLUMNS.map((key) => {
    if (key === 'history') {
      return JSON.stringify(a.history || []);
    }
    if (key === 'klaerung') {
      // Leere Klaerung als leere Zelle speichern (nicht als "null"-String)
      return a.klaerung && typeof a.klaerung === 'object' ? JSON.stringify(a.klaerung) : '';
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
    const tab = await ersterTabName(sheets, SHEET_ID);
    const RANGE = tab + '!A2:' + LETZTE_SPALTE + '1000';

    // -------------------- READ --------------------
    if (event.httpMethod === 'GET') {
      // Bewusst ab Zeile 1 lesen: so laesst sich in einem Call pruefen, ob die
      // Header der neuen Spalten (Z/AA) schon stehen — ohne Extra-Request.
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: tab + '!A1:' + LETZTE_SPALTE + '1000',
      });
      const alle = res.data.values || [];
      const header = alle[0] || [];
      const rows = alle.slice(1);
      await kopfzeilenSicherstellen(sheets, tab, header);
      const data = rows
        .filter((r) => r && r.length > 0 && r[0])
        .map(rowToObject);
      return jsonResponse(200, { success: true, data });
    }

    // -------------------- WRITE --------------------
    if (event.httpMethod === 'POST') {
      const payload = JSON.parse(event.body || '{}');
      const anfragen = Array.isArray(payload.anfragen) ? payload.anfragen : [];

      // Schutz der Standort-Rueckfragen vor dem Full-Table-Rewrite:
      // Dieser POST schreibt die KOMPLETTE Tabelle aus dem Browser-State
      // zurueck. Der State kann bis zu 60 Sekunden alt sein (Auto-Refresh) —
      // eine Rueckfrage, die in diesem Fenster vom ANDEREN Standort gestellt
      // oder beantwortet wurde, wuerde dabei verloren gehen. Die Klaerungs-
      // Spalte wird deshalb nie aus dem Payload uebernommen, sondern immer aus
      // dem Sheet gehalten; geschrieben wird sie ausschliesslich feldgranular
      // durch klaerung-update.js. Zuordnung ueber die id (nicht ueber die
      // Zeilennummer), damit Loeschen/Sortieren nichts verschiebt.
      let klaerungImSheet = new Map();
      try {
        const vorher = await sheets.spreadsheets.values.get({
          spreadsheetId: SHEET_ID,
          range: RANGE,
        });
        (vorher.data.values || []).forEach((r) => {
          const id = r && r[0];
          const wert = r && r[COLUMNS.indexOf('klaerung')];
          if (id && wert) klaerungImSheet.set(String(id), String(wert));
        });
      } catch (e) {
        // Nicht fatal: dann gilt der Payload-Wert (bisheriges Verhalten).
        console.error('Klaerungs-Spalte konnte nicht vorgelesen werden:', e && e.message);
      }

      const values = anfragen.map((a) => {
        const row = objectToRow(a);
        const idx = COLUMNS.indexOf('klaerung');
        const ausSheet = klaerungImSheet.get(String(a.id || ''));
        if (ausSheet) row[idx] = ausSheet;
        return row;
      });

      // Erst Datenbereich leeren, dann komplette Liste schreiben
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SHEET_ID,
        range: RANGE,
      });

      if (values.length > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: tab + '!A2',
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

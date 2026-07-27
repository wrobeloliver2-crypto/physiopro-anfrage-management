// Gemeinsame Helfer für die Kruse-Datenanforderungen-Functions
// (kruse-list-anfragen, kruse-update-status).
//
// Nutzt bewusst dieselben Zugangsdaten wie kruse-consent-log.js im
// physiopro-website-Repo (KRUSE_GOOGLE_CLIENT_EMAIL / KRUSE_GOOGLE_PRIVATE_KEY,
// beide hier als Kopie hinterlegt), statt des GOOGLE_SERVICE_ACCOUNT dieses
// Repos — so ist keine zusätzliche Google-Drive-Freigabe des Kruse-Sheets
// nötig, es bleibt bei genau einem Schreib-Account für dieses Sheet.
//
// Hinweis: .cjs statt .js, weil package.json "type":"module" setzt — als
// .js würde Node diese CommonJS-Datei (require/module.exports) als ES-Modul
// laden und der handler-Export der aufrufenden Functions ginge verloren
// (Runtime.HandlerNotFound). .cjs erzwingt CommonJS unabhängig davon.
const { google } = require('googleapis');

const SHEET_ID = () => process.env.KRUSE_SHEET_ID;
const SHEET_NAME = 'Tabellenblatt1';
const RANGE = `${SHEET_NAME}!A2:K1000`;

const HEADERS = [
  'zeitstempel', 'name', 'geburtsdatum', 'telefon', 'hinweis',
  'id', 'status', 'bearbeiter', 'angefordertAm', 'notizen', 'history',
];

async function getSheetsClient() {
  const auth = new google.auth.JWT(
    process.env.KRUSE_GOOGLE_CLIENT_EMAIL,
    null,
    (process.env.KRUSE_GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

// Liest alle Fälle. Leere Zeilen (weder Name noch id) werden übersprungen.
async function sheetReadAll() {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID(),
    range: RANGE,
  });
  const rows = res.data.values || [];
  return rows
    .map((row, i) => {
      const obj = { _rowIndex: i + 2 }; // 1-basiert + Headerzeile
      HEADERS.forEach((h, j) => { obj[h] = row[j] || ''; });
      try { obj.history = obj.history ? JSON.parse(obj.history) : []; } catch (e) { obj.history = []; }
      return obj;
    })
    .filter((r) => r.name || r.id);
}

// Schreibt eine komplette Zeile (A–K) an der gegebenen 1-basierten Zeilennummer.
async function sheetUpdateRow(rowIndex, values) {
  const sheets = await getSheetsClient();
  const range = `${SHEET_NAME}!A${rowIndex}:K${rowIndex}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID(),
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] },
  });
}

module.exports = { sheetReadAll, sheetUpdateRow, HEADERS, SHEET_NAME };

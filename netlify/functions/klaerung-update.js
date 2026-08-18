// ====================================================================
// Netlify Function: klaerung-update
// Feldgranulares Schreiben der Standort-Rückfrage (Spalte AA "Klärung")
// PhysioPro Anfrage-Management
// --------------------------------------------------------------------
// Warum eigene Function statt sheets-api (POST)?
// sheets-api schreibt beim Speichern IMMER die komplette Tabelle zurück
// (values.clear über A2:AA1000 + values.update). Solange nur eine Rezeption
// am Board arbeitet, ist das unkritisch. Die Standort-Rückfrage lässt aber
// bewusst ZWEI Standorte gleichzeitig an denselben Karten arbeiten — dann
// kann ein Full-Table-Rewrite die Änderung des anderen Standorts
// überschreiben (kein optimistisches Locking im Sheet).
// Diese Function schreibt deshalb nur die beiden Zellen, die eine Rückfrage
// tatsächlich verändert:
//   - AA{row}  Klärung (JSON)
//   - N{row}   Änderungs-History (JSON, read-modify-write nur dieser Zelle)
// Muster übernommen von priority-update.mts (dort: nur die Prioritäts-Zelle).
//
// Spaltenzuordnung ist POSITIONELL (wie in sheets-api.js), nicht über die
// Header-Texte — das ist der etablierte Vertrag im Repo: A..AA in fester
// Reihenfolge, Zeile 1 = Header.
// ====================================================================
const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

// Positionen im Sheet-Schema A..AA (0-basiert)
const IDX_ID = 0;         // A
const IDX_HISTORY = 13;   // N
const IDX_KLAERUNG = 26;  // AA
const SPALTEN_ANZAHL = 27; // A..AA
const LETZTE_SPALTE = 'AA';

// Erlaubte Werte, damit über diese Function nichts Beliebiges ins Sheet kann
const STANDORTE = ['bad-schwartau', 'stockelsdorf'];
const STATI = ['offen', 'beantwortet', 'geschlossen'];
const MAX_TEXT = 2000;
const MAX_VERLAUF = 50;

function getSheets() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// Ersten Tab ermitteln (identisch zu sheets-api.js) und dabei prüfen, ob das
// Raster überhaupt bis Spalte AA reicht. Fehlt Platz, wird er angelegt —
// idempotent, kostet im Normalfall keinen zusätzlichen API-Call.
async function tabVorbereiten(sheets) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
    fields: 'sheets.properties(sheetId,title,gridProperties)',
  });
  const props = (meta.data.sheets && meta.data.sheets[0] && meta.data.sheets[0].properties) || {};
  const titel = props.title || 'Tabelle1';
  const spalten = (props.gridProperties && props.gridProperties.columnCount) || 0;
  if (props.sheetId !== undefined && spalten > 0 && spalten < SPALTEN_ANZAHL) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
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
  }
  return titel;
}

// ---- Eingehende Klärung säubern (nur bekannte Felder/Werte übernehmen) ----
function saubereKlaerung(roh) {
  if (!roh || typeof roh !== 'object') return null;
  const von = STANDORTE.includes(roh.von) ? roh.von : '';
  const an = STANDORTE.includes(roh.an) ? roh.an : '';
  const status = STATI.includes(roh.status) ? roh.status : '';
  if (!von || !an || !status || von === an) return null;
  const verlaufRoh = Array.isArray(roh.verlauf) ? roh.verlauf.slice(-MAX_VERLAUF) : [];
  const verlauf = verlaufRoh.map((e) => ({
    zeit: typeof e.zeit === 'string' ? e.zeit : new Date().toISOString(),
    autor: String(e.autor || '').slice(0, 120),
    richtung: e.richtung === 'antwort' ? 'antwort' : 'frage',
    von: STANDORTE.includes(e.von) ? e.von : '',
    an: STANDORTE.includes(e.an) ? e.an : '',
    text: String(e.text || '').slice(0, MAX_TEXT),
  }));
  return { von, an, status, verlauf };
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
  if (event.httpMethod === 'OPTIONS') return jsonResponse(200, { success: true });
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { success: false, error: 'Method not allowed' });
  }
  if (!SHEET_ID || !process.env.GOOGLE_SERVICE_ACCOUNT) {
    return jsonResponse(500, {
      success: false,
      error: 'Server nicht konfiguriert (GOOGLE_SHEET_ID / GOOGLE_SERVICE_ACCOUNT fehlt)',
    });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return jsonResponse(400, { success: false, error: 'Ungültiger Request-Body' });
  }

  const id = String(payload.id || '').trim();
  if (!id) return jsonResponse(400, { success: false, error: 'id fehlt' });

  const klaerung = saubereKlaerung(payload.klaerung);
  if (!klaerung) return jsonResponse(400, { success: false, error: 'klaerung unvollständig oder unzulässig' });

  const histEintrag = payload.historyEintrag && typeof payload.historyEintrag === 'object'
    ? {
        zeitstempel: typeof payload.historyEintrag.zeitstempel === 'string'
          ? payload.historyEintrag.zeitstempel : new Date().toISOString(),
        aktion: String(payload.historyEintrag.aktion || 'Rückfrage').slice(0, 60),
        von: String(payload.historyEintrag.von || '').slice(0, 120),
        details: String(payload.historyEintrag.details || '').slice(0, MAX_TEXT),
      }
    : null;

  try {
    const sheets = getSheets();
    const tab = await tabVorbereiten(sheets);

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: tab + '!A2:' + LETZTE_SPALTE + '1000',
    });
    const rows = res.data.values || [];

    // Letzten Treffer nehmen (jüngste Zeile gewinnt, falls eine id doppelt
    // vorkommt — gleiche Konvention wie in priority-update.mts).
    let treffer = -1;
    for (let i = 0; i < rows.length; i++) {
      if (String((rows[i] || [])[IDX_ID] || '').trim() === id) treffer = i;
    }
    if (treffer === -1) {
      return jsonResponse(404, { success: false, error: 'Anfrage nicht gefunden (id ' + id + ')' });
    }
    const zeile = treffer + 2; // +1 Header, +1 weil 1-basiert

    // History dieser Zeile lesen, Eintrag anhängen (nur diese Zelle)
    const daten = [{
      range: tab + '!' + LETZTE_SPALTE + zeile,
      values: [[JSON.stringify(klaerung)]],
    }];
    if (histEintrag) {
      let hist = [];
      try {
        const rohHist = (rows[treffer] || [])[IDX_HISTORY];
        const parsed = rohHist ? JSON.parse(rohHist) : [];
        if (Array.isArray(parsed)) hist = parsed;
      } catch (e) { hist = []; }
      hist.push(histEintrag);
      daten.push({ range: tab + '!N' + zeile, values: [[JSON.stringify(hist)]] });
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { valueInputOption: 'USER_ENTERED', data: daten },
    });

    return jsonResponse(200, { success: true, zeile, id });
  } catch (err) {
    console.error('klaerung-update error:', err);
    const code = err.code === 403 ? 403 : err.code === 429 ? 429 : 500;
    return jsonResponse(code, {
      success: false,
      error: 'Google Sheets API error: ' + (err.message || 'unknown'),
    });
  }
};

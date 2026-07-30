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
  'dsgvoEinwilligungKruse', // Z
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

// ---- Schutz: eigene Praxisnummer ist NIE eine gültige Rückrufnummer ----
// Hintergrund: Die Telefon-KI kann fälschlich die Praxisnummer als Rufnummer
// des Anrufers übergeben (Halluzination aus der Wissensdatenbank). Eine solche
// Nummer darf nicht als echte Patientennummer ins Sheet, sonst klingelt ein
// Rückruf bei uns selbst. Vergleich auf die letzten 9 Ziffern (robust gegen
// Schreibweisen 0451…, +4945…, 0049451…).
const PRAXIS_NUMMERN = ['+4945140073073']; // Praxis Lübeck, normalisiert
function ziffernKern(tel) {
  const d = String(tel || '').replace(/[^0-9]/g, '');
  return d.length > 9 ? d.slice(-9) : d;
}
function istPraxisnummer(tel) {
  const k = ziffernKern(tel);
  if (!k) return false;
  return PRAXIS_NUMMERN.some((p) => ziffernKern(p) === k);
}

// ---- DSGVO-Einwilligung (Kruse) aus dem Mailtext ableiten ----
// Hintergrund: termin.html (Bad Schwartau) schreibt den Einwilligungsstatus
// zur Datenanforderung bei Frau Thompson explizit als Text
// "Einwilligung Datenanforderung bei Frau Thompson: JA" bzw. "... NEIN" in
// die Anfrage. Auf dem Mail-Weg (Flow #1 -> diese Function) kommt dieser
// Text im Anliegen (oder ggf. in den Notizen) an, wurde bislang aber nicht
// in Spalte Z (dsgvoEinwilligungKruse) übernommen. Diese Funktion holt ihn
// dort heraus. Rein additiv: greift nur, wenn der Payload das Feld nicht
// bereits explizit selbst mitschickt, und beeinflusst keine andere Quelle.
function parseKruseConsent(text) {
  const m = /Einwilligung Datenanforderung bei Frau Thompson:\s*(JA|NEIN)/i.exec(String(text || ''));
  if (!m) return '';
  return m[1].toUpperCase() === 'JA' ? 'Ja' : 'Nein';
}

// ---- Priorität "Sofort" für Anfragen über /privat-versichert erzwingen ----
// Hintergrund (Oliver, 30.07.2026): Anfragen über die Landingpage
// physioproluebeck.de/privat-versichert sollen automatisch mit Priorität
// "Sofort" ins Dashboard kommen, unabhängig davon, was Flow #1 im Payload
// mitschickt. Erkennungsmerkmal ist der feste Text "Herkunft: /privat-
// versichert", den privat-versichert.html jeder Nachricht anhängt (siehe
// pvSubmit() in privat-versichert.html, Repo physiopro-website). Bewusst
// als eigene erzwingende Regel NACH dem generischen Payload-Fallback
// (payload.prioritaet || 'Normal') angewendet, nicht als weiterer Fallback-
// Wert selbst — soll auch dann greifen, wenn der Flow versehentlich schon
// "Normal" oder einen anderen Wert mitschickt.
function istPrivatVersichertAnfrage(anliegen) {
  return /Herkunft:\s*\/privat-versichert/i.test(String(anliegen || ''));
}

// ---- Priorität "Niedrig" für Terminabsagen erzwingen (alle Kanäle) ----
// Hintergrund (Oliver, 30.07.2026): Terminabsagen sollen unabhängig vom
// Eingangskanal (Telefon-KI/Placetel, Netlify-Webformular, SMS-Rückruf,
// manuell erfasst) automatisch mit Priorität "Niedrig" ins Dashboard
// kommen, weil sie in der Regel keine dringende Bearbeitung brauchen.
// Erkennung bewusst NUR über das feste Schlüsselwort "Terminabsage"
// (deckt alle bisher beobachteten echten Formulierungen ab, siehe u.a.
// Telefon-KI-Texte wie "Terminabsage für den ... Uhr" oder "Terminabsage,
// Termin am ..."), NICHT über freiere Formulierungsmuster ("möchte
// absagen", "kann nicht kommen" o.ä.) — solche Muster ließen sich nicht
// zuverlässig von ähnlich klingenden, aber anderen Anliegen abgrenzen
// (Entscheidung von Oliver: robuste Erkennung über Perfektion gestellt).
// Rangfolge: Falls sowohl Terminabsage ALS AUCH /privat-versichert
// zutreffen (siehe istPrivatVersichertAnfrage), hat "Niedrig" Vorrang vor
// "Sofort" — die Terminabsage-Prüfung wird deshalb an der Anwendungsstelle
// bewusst ALS LETZTES ausgewertet.
function istTerminabsage(anliegen) {
  return /termin\s*absage/i.test(String(anliegen || ''));
}

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

  // ---- Guard: HTML-/Müll-Payloads verwerfen (keine Karte anlegen) ----
  // Hintergrund: Gelegentlich landet statt sauberem Formulartext roher
  // HTML-Quelltext im Mail-Body (Auto-Antwort, Bounce, fremdes Mailformat).
  // Der Flow-Parser schreibt dann z.B. "<html lang=\"en\"><head>" in Name/
  // Anliegen. Solche Payloads werden hier verworfen, BEVOR eine Zeile
  // entsteht. Rückgabe 200 (nicht 4xx), damit Flow #1 die Function als
  // "erledigt" sieht und NICHT in Retry/429 läuft.
  const HTML_MARKER = /<\s*(html|head|meta|body|!doctype|div|span|style|script|table|title|link)\b/i;
  const nameRoh     = String(payload.name || '').trim();
  const anliegenRoh = String(payload.anliegen || '').trim();
  const istMuell =
    HTML_MARKER.test(nameRoh) ||
    HTML_MARKER.test(anliegenRoh) ||
    nameRoh.startsWith('<') ||
    anliegenRoh.startsWith('<');
  if (istMuell) {
    console.log('anfrage-create: Müll-Payload verworfen (HTML im Text)', {
      name: nameRoh.slice(0, 60),
    });
    return jsonResponse(200, { success: true, skipped: 'muell-guard' });
  }

  // ---- Zeile aufbauen ----
  // History: akzeptiert fertiges JSON-String oder Array. WICHTIG: Egal was
  // Power Automate im history-Feld mitschickt (auch ein leeres Array "[]"
  // zaehlt als "vorhanden" und wuerde sonst den Standardeintrag ueberspringen)
  // -- es wird IMMER sichergestellt, dass ein "Erstellt"-Eintrag mit echtem
  // Zeitstempel existiert. Nur so zeigt das Dashboard die Eingangs-Uhrzeit
  // der Karte an (eingangsZeit() in App.jsx liest genau diesen Eintrag).
  let historyArr;
  if (typeof payload.history === 'string' && payload.history.trim()) {
    try {
      const parsed = JSON.parse(payload.history);
      historyArr = Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      historyArr = [];
    }
  } else if (Array.isArray(payload.history)) {
    historyArr = payload.history;
  } else {
    historyArr = [];
  }
  const hatErstelltEintrag = historyArr.some(
    (e) => e && (e.aktion === 'Erstellt' || e.feld === 'Erstellt') && e.zeitstempel
  );
  if (!hatErstelltEintrag) {
    historyArr = [{
      zeitstempel: new Date().toISOString(),
      feld: 'Erstellt',
      benutzer: 'Flow #1',
      wert: payload.quelle || 'E-Mail-Eingang',
    }, ...historyArr];
  }
  let historyStr = JSON.stringify(historyArr);

  // ---- Telefon prüfen: Praxisnummer abfangen (s.o.) ----
  const telNormalisiert = normalizeTelefon(payload.telefon);
  const telIstPraxis = istPraxisnummer(telNormalisiert);
  const telFinal = telIstPraxis ? '' : telNormalisiert;

  // Bei abgefangener Praxisnummer einen Protokoll-Eintrag in die History legen.
  if (telIstPraxis) {
    try {
      const arr = JSON.parse(historyStr);
      if (Array.isArray(arr)) {
        arr.push({
          zeitstempel: new Date().toISOString(),
          feld: 'Telefon',
          benutzer: 'System',
          wert: 'Praxisnummer als Rückrufnummer übergeben – verworfen, bitte beim Patienten erfragen',
        });
        historyStr = JSON.stringify(arr);
      }
    } catch (e) { /* History bleibt unverändert, kein harter Fehler */ }
  }

  // ---- DSGVO-Einwilligung (Kruse) bestimmen: expliziter Payload-Wert hat
  // Vorrang, sonst aus Anliegen bzw. Notizen geparst (s.o.) ----
  const dsgvoEinwilligungKruse =
    payload.dsgvoEinwilligungKruse ||
    parseKruseConsent(payload.anliegen) ||
    parseKruseConsent(payload.notizen) ||
    '';

  const prioritaetVorPruefung = istPrivatVersichertAnfrage(payload.anliegen)
    ? 'Sofort'
    : (payload.prioritaet || 'Normal');
  const prioritaetFinal = istTerminabsage(payload.anliegen)
    ? 'Niedrig'
    : prioritaetVorPruefung;

  const obj = {
    id: payload.id || ('mail-' + Date.now()),
    eingangsdatum: payload.eingangsdatum || new Date().toISOString().slice(0, 10),
    quelle: payload.quelle || 'Website',
    name: payload.name || '',
    telefon: telFinal,
    email: payload.email || '',
    anliegen: (payload.anliegen || '') + (telIstPraxis ? ' ⚠️ Rückrufnummer fehlt (Praxisnummer übergeben – bitte beim Patienten erfragen)' : ''),
    prioritaet: prioritaetFinal,
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
    dsgvoEinwilligungKruse, // Z
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

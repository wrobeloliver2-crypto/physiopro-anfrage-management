// ====================================================================
// Netlify Function: missed-call
// Empfängt Placetel-Nachbearbeitung nach jedem Anruf.
// Prüft ob Mobilnummer → sendet SMS mit Rückruf-Link.
// Auth: x-api-key Header muss FLOW_API_KEY entsprechen.
// ====================================================================

const FLOW_API_KEY = process.env.FLOW_API_KEY;
const PLACETEL_API_KEY = process.env.PLACETEL_API_KEY;
const SITE_URL = 'https://physioproluebeck.de';

// Prüft ob eine deutsche Mobilnummer vorliegt
function isMobilnummer(nummer) {
  if (!nummer) return false;
  // Normalisieren: +49170... oder 0170... oder 49170...
  const n = String(nummer).replace(/\s/g, '');
  return /^(\+49|0049|0)(15[0-9]|16[0-9]|17[0-9])/.test(n);
}

// Normalisiert auf +49-Format für Placetel API
function normalizeZuPlusFormat(nummer) {
  let n = String(nummer).replace(/[^0-9+]/g, '');
  if (n.startsWith('00')) n = '+' + n.slice(2);
  if (n.startsWith('0')) n = '+49' + n.slice(1);
  if (!n.startsWith('+')) n = '+49' + n;
  return n;
}

// URL-safe Base64 für den tel-Parameter
function encodeNummer(nummer) {
  return encodeURIComponent(normalizeZuPlusFormat(nummer));
}

async function sendeSMS(empfaenger, text) {
  const response = await fetch('https://api.placetel.de/v2/sms', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${PLACETEL_API_KEY}`,
    },
    body: JSON.stringify({
      to: normalizeZuPlusFormat(empfaenger),
      text,
      sender: 'PhysioPro',
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Placetel SMS API Fehler (${response.status}): ${err}`);
  }
  return await response.json();
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
  if (event.httpMethod === 'OPTIONS') return jsonResponse(200, { ok: true });
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  // Auth
  if (!FLOW_API_KEY) return jsonResponse(500, { error: 'Server nicht konfiguriert (FLOW_API_KEY fehlt)' });
  const key = event.headers['x-api-key'] || event.headers['X-Api-Key'];
  if (key !== FLOW_API_KEY) return jsonResponse(401, { error: 'Unauthorized' });

  if (!PLACETEL_API_KEY) return jsonResponse(500, { error: 'Server nicht konfiguriert (PLACETEL_API_KEY fehlt)' });

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { error: 'Ungültiges JSON' });
  }

  const { caller_number, summary, datetime } = payload;

  if (!caller_number) {
    return jsonResponse(400, { error: 'caller_number fehlt' });
  }

  // Nur Mobilnummern bekommen eine SMS
  if (!isMobilnummer(caller_number)) {
    console.log(`missed-call: Festnetz oder unbekannt (${caller_number}) — keine SMS`);
    return jsonResponse(200, { ok: true, sms: false, grund: 'Keine Mobilnummer' });
  }

  const rueckrufLink = `${SITE_URL}/rueckruf-sms?tel=${encodeNummer(caller_number)}`;

  const smsText =
    `Hallo, Sie haben gerade versucht PhysioPro Lübeck zu erreichen. ` +
    `Wir helfen Ihnen gerne! Rückruf gewünscht? Einfach hier bestätigen: ${rueckrufLink}`;

  try {
    await sendeSMS(caller_number, smsText);
    console.log(`missed-call: SMS gesendet an ${caller_number}`);
    return jsonResponse(200, { ok: true, sms: true, empfaenger: caller_number });
  } catch (err) {
    console.error('missed-call SMS-Fehler:', err.message);
    return jsonResponse(500, { error: err.message });
  }
};

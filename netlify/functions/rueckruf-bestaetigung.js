// ====================================================================
// Netlify Function: rueckruf-bestaetigung
// Öffentlicher Endpunkt — wird vom Browser auf rueckruf-sms.html
// aufgerufen, wenn der Patient den Rückruf-Link bestätigt.
//
// Kein API-Key nötig (Browser-seitig), aber Rate-Limit-freundlich:
// Einfaches Weiterleiten an anfrage-create (server-to-server mit Key).
// ====================================================================

const FLOW_API_KEY = process.env.FLOW_API_KEY;

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
  if (event.httpMethod === 'OPTIONS') return jsonResponse(200, { ok: true });
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  if (!FLOW_API_KEY) return jsonResponse(500, { error: 'Server nicht konfiguriert' });

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { error: 'Ungültiges JSON' });
  }

  const { telefon } = payload;
  if (!telefon) return jsonResponse(400, { error: 'Telefonnummer fehlt' });

  const anfrage = {
    quelle: 'SMS-Rückrufwunsch',
    telefon,
    name: 'Verpasster Anruf',
    anliegen: 'Bitte anrufen – Name & Anliegen erfragen',
    prioritaet: 'Normal',
    history: JSON.stringify([{
      zeitstempel: new Date().toISOString(),
      feld: 'Erstellt',
      benutzer: 'SMS-Rückruf',
      wert: 'Verpasster Anruf – Rückruf via SMS-Link bestätigt',
    }]),
  };

  try {
    // Eigenen Host aus dem Request ableiten → develop ruft develop,
    // Production ruft Production (kein hartcodierter URL-Wert).
    const proto = event.headers['x-forwarded-proto'] || 'https';
    const host = event.headers.host;
    const selfBase = `${proto}://${host}`;

    const res = await fetch(`${selfBase}/.netlify/functions/anfrage-create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': FLOW_API_KEY,
      },
      body: JSON.stringify(anfrage),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    return jsonResponse(200, { ok: true });
  } catch (err) {
    console.error('rueckruf-bestaetigung Fehler:', err.message);
    return jsonResponse(500, { error: 'Anfrage konnte nicht gespeichert werden: ' + err.message });
  }
};

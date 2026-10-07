// ====================================================================
// Zugangsschutz fuer die Dashboard-Functions
// --------------------------------------------------------------------
// Anmeldung pro Person mit der PIN aus der Mitarbeiter-Datenbank
// (dashboard-login). Zugelassen ist nur, wer dort die Taetigkeit
// "Rezeption" hat oder Admin ist (Personenliste des Mitarbeiter-Dienstes,
// Feld taetigkeiten). Bei Erfolg
// stellt das Dashboard ein eigenes, signiertes Token aus, das Name und
// Rechte der Person enthaelt. Jede Daten-Function verlangt es im Header
//   Authorization: Bearer <token>
//
// Ein Token aus einer anderen App (z. B. Zeiterfassung) gilt hier NICHT,
// weil es mit einem anderen Geheimnis signiert ist.
//
// Env:
//   DASHBOARD_TOKEN_SECRET  Signier-Schluessel (lang, zufaellig)
// ====================================================================
const crypto = require('crypto');

const GUELTIGKEIT_STUNDEN = 12; // wie der zentrale Mitarbeiter-Login

function geheimnis() {
  return process.env.DASHBOARD_TOKEN_SECRET || '';
}

function kennwort() {
  return process.env.DASHBOARD_PW || process.env.VITE_DASHBOARD_PW || '';
}

// Personen, die alles sehen, aber nichts aendern duerfen (wie bisher READ_ONLY_USERS).
// Abgleich ueber die feste id des Physio-Pro-Verhaeltnisses (mitarbeiter_firma.id),
// nicht ueber den Namen – ein spaeter gesetzter Rufname aendert daran nichts.
// Seit 07.10.2026 leer: Hanna (33) und Oliver (34) haben volle Rechte.
// Mechanismus bleibt, falls spaeter wieder jemand nur lesen soll.
const NUR_LESEN_IDS = [];
const NUR_LESEN = []; // nur noch fuer die Anzeige im Frontend

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signatur(payload) {
  return b64url(crypto.createHmac('sha256', geheimnis()).update(payload).digest());
}

function gleich(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// person: { mf, name, rolle }  (rolle: 'admin' | 'mitarbeiter')
function tokenErstellen(person = {}) {
  const daten = {
    exp: Date.now() + GUELTIGKEIT_STUNDEN * 3600 * 1000,
    mf: person.mf || null,
    name: person.name || '',
    rolle: person.rolle || 'mitarbeiter',
    lesend: NUR_LESEN_IDS.includes(Number(person.mf)),
  };
  const payload = b64url(JSON.stringify(daten));
  return payload + '.' + signatur(payload);
}

// Liefert die Sitzungsdaten oder null
function tokenLesen(token) {
  if (!geheimnis() || !token || typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig || !gleich(sig, signatur(payload))) return null;
  try {
    const daten = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return typeof daten.exp === 'number' && daten.exp > Date.now() ? daten : null;
  } catch (e) {
    return null;
  }
}

function tokenGueltig(token) {
  return !!tokenLesen(token);
}

function sitzungAus(event) {
  const h = (event && event.headers) || {};
  const roh = h.authorization || h.Authorization || '';
  return tokenLesen(roh.startsWith('Bearer ') ? roh.slice(7).trim() : '');
}

function kennwortRichtig(eingabe) {
  const soll = kennwort();
  return !!soll && gleich(eingabe || '', soll);
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Liefert null, wenn der Aufruf berechtigt ist, sonst die fertige 401-Antwort.
function zugriffPruefen(event) {
  if (sitzungAus(event)) return null;
  return {
    statusCode: 401,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    body: JSON.stringify({ success: false, error: 'Nicht angemeldet', code: 'AUTH' }),
  };
}

module.exports = { tokenErstellen, tokenGueltig, tokenLesen, sitzungAus, kennwortRichtig, zugriffPruefen, CORS_HEADERS, geheimnis, NUR_LESEN };

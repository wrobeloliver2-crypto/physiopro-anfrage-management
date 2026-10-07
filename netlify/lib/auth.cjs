// ====================================================================
// Zugangsschutz fuer die Dashboard-Functions
// --------------------------------------------------------------------
// Bisher war das Kennwort nur eine Sperre in der Oberflaeche
// (VITE_DASHBOARD_PW, fest ins ausgelieferte JavaScript kompiliert).
// Die Daten-Functions selbst waren ohne jeden Schutz erreichbar.
//
// Jetzt: Das Kennwort wird ausschliesslich serverseitig geprueft
// (dashboard-login). Bei Erfolg gibt es ein signiertes Token mit
// Ablaufzeit; jede Daten-Function verlangt es im Header
//   Authorization: Bearer <token>
//
// Env:
//   DASHBOARD_PW            Kennwort (Fallback: VITE_DASHBOARD_PW, damit
//                           der bestehende Wert weiter gilt)
//   DASHBOARD_TOKEN_SECRET  Signier-Schluessel (lang, zufaellig)
// ====================================================================
const crypto = require('crypto');

const GUELTIGKEIT_STUNDEN = 14; // ein Praxistag inkl. Puffer

function geheimnis() {
  return process.env.DASHBOARD_TOKEN_SECRET || '';
}

function kennwort() {
  return process.env.DASHBOARD_PW || process.env.VITE_DASHBOARD_PW || '';
}

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

function tokenErstellen() {
  const payload = b64url(JSON.stringify({ exp: Date.now() + GUELTIGKEIT_STUNDEN * 3600 * 1000 }));
  return payload + '.' + signatur(payload);
}

function tokenGueltig(token) {
  if (!geheimnis() || !token || typeof token !== 'string') return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig || !gleich(sig, signatur(payload))) return false;
  try {
    const daten = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return typeof daten.exp === 'number' && daten.exp > Date.now();
  } catch (e) {
    return false;
  }
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
  const h = event.headers || {};
  const roh = h.authorization || h.Authorization || '';
  const token = roh.startsWith('Bearer ') ? roh.slice(7).trim() : '';
  if (tokenGueltig(token)) return null;
  return {
    statusCode: 401,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    body: JSON.stringify({ success: false, error: 'Nicht angemeldet', code: 'AUTH' }),
  };
}

module.exports = { tokenErstellen, tokenGueltig, kennwortRichtig, zugriffPruefen, CORS_HEADERS, geheimnis };

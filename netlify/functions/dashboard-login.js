// ====================================================================
// Netlify Function: dashboard-login
// Anmeldung am Anfragen-Dashboard mit der persoenlichen PIN aus der
// zentralen Mitarbeiter-Datenbank.
//
//   GET  -> Liste der Personen, die sich anmelden duerfen (nur Name + id)
//   POST { userId, pin } -> { token, user } bei Erfolg
//
// Ablauf POST:
//   1. Darf die Person ueberhaupt ins Dashboard? Pruefung in der
//      Mitarbeiter-DB (View v_anfragen_zugang: Taetigkeit Rezeption oder
//      Admin). Die DB-Rolle dafuer sieht NUR diese View.
//   2. PIN-Pruefung macht der zentrale Mitarbeiter-Dienst (mitarbeiter-api,
//      app "anfragen") – inkl. Sperre nach Fehlversuchen und Login-Protokoll.
//   3. Erst dann stellt das Dashboard sein eigenes Token aus (auth.cjs).
//
// Env:
//   MITARBEITER_DATABASE_URL  Nur-Lese-Zugang (Rolle anfragen_lesen)
//   MITARBEITER_API_URL       Standard https://mitarbeiter-api.netlify.app
//   DASHBOARD_TOKEN_SECRET
// ====================================================================
const { neon } = require('@neondatabase/serverless');
const { tokenErstellen, tokenLesen, CORS_HEADERS, geheimnis } = require('../lib/auth.cjs');

const API_URL = (process.env.MITARBEITER_API_URL || 'https://mitarbeiter-api.netlify.app').replace(/\/+$/, '');

const antwort = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS_HEADERS },
  body: JSON.stringify(body),
});

const FEHLERTEXTE = {
  pin_falsch: 'PIN falsch',
  gesperrt: 'Zu viele Fehlversuche – bitte 15 Minuten warten',
  keine_pin: 'Noch keine PIN festgelegt – bitte zuerst in der Zeiterfassung eine PIN anlegen',
  pin_format: 'Die PIN hat 4 bis 6 Ziffern',
  app_gesperrt: 'Kein Zugang zum Dashboard',
  unbekannt: 'Person nicht gefunden',
};

let _sql = null;
function mitarbeiterDb() {
  if (!_sql) _sql = neon(process.env.MITARBEITER_DATABASE_URL);
  return _sql;
}

async function zugelassene() {
  return mitarbeiterDb().query(
    `SELECT mitarbeiter_firma_id, anzeigename, ist_admin, ist_rezeption, pin_gesetzt
       FROM v_anfragen_zugang
      ORDER BY ist_admin, anzeigename`
  );
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return antwort(200, { success: true });
  if (!geheimnis() || !process.env.MITARBEITER_DATABASE_URL) {
    return antwort(500, { success: false, error: 'Server nicht konfiguriert (DASHBOARD_TOKEN_SECRET / MITARBEITER_DATABASE_URL fehlt)' });
  }

  try {
    if (event.httpMethod === 'GET') {
      const liste = await zugelassene();
      return antwort(200, {
        success: true,
        personen: liste.map((p) => ({
          id: String(p.mitarbeiter_firma_id),
          name: p.anzeigename,
          verwaltung: !!p.ist_admin,
          pinGesetzt: !!p.pin_gesetzt,
        })),
      });
    }

    if (event.httpMethod !== 'POST') return antwort(405, { success: false, error: 'Method not allowed' });

    let daten = {};
    try { daten = JSON.parse(event.body || '{}'); } catch (e) { /* leer */ }
    const userId = Number(daten.userId);
    const pin = String(daten.pin || '');
    if (!userId || !/^\d{4,6}$/.test(pin)) return antwort(400, { success: false, error: FEHLERTEXTE.pin_format });

    // 1. Zugang pruefen (Rezeption oder Admin)
    const person = (await zugelassene()).find((p) => Number(p.mitarbeiter_firma_id) === userId);
    if (!person) return antwort(403, { success: false, error: FEHLERTEXTE.app_gesperrt });

    // 2. PIN beim zentralen Mitarbeiter-Dienst pruefen
    const res = await fetch(API_URL + '/.netlify/functions/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', app: 'anfragen', data: { userId, pin } }),
    });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('mitarbeiter-api antwortet', res.status, r);
      return antwort(502, { success: false, error: 'Anmeldedienst gerade nicht erreichbar' });
    }
    if (r.error || !r.token) {
      const text = FEHLERTEXTE[r.error] || 'Anmeldung fehlgeschlagen';
      const zusatz = r.error === 'pin_falsch' && typeof r.verbleibend === 'number' ? ` (noch ${r.verbleibend} Versuche)` : '';
      return antwort(401, { success: false, error: text + zusatz, code: r.error || 'fehler' });
    }

    // 3. Eigenes Dashboard-Token ausstellen
    const name = person.anzeigename;
    const rolle = person.ist_admin ? 'admin' : 'mitarbeiter';
    const token = tokenErstellen({ mf: userId, name, rolle });
    const sitzung = tokenLesen(token);
    return antwort(200, {
      success: true,
      token,
      user: { id: String(userId), name, rolle, lesend: !!sitzung.lesend },
    });
  } catch (err) {
    console.error('dashboard-login Fehler:', err);
    return antwort(500, { success: false, error: 'Anmeldung gerade nicht möglich' });
  }
};

// ====================================================================
// Netlify Function: anfragen-api
// Lesen und Speichern der Anfragen-Karten in Postgres (Neon).
// Nachfolger von sheets-api.
//
//   GET   -> alle Karten (gleiches Format wie bisher sheets-api)
//   POST  { upsert: [karte, ...], loeschen: [id, ...] }
//         -> speichert NUR die mitgeschickten Karten, loescht NUR die
//            genannten ids. Es wird nie die ganze Tabelle ueberschrieben.
//
// Die History einer Karte wird beim Speichern mit dem Stand in der
// Datenbank vereinigt (kein Verlaufseintrag geht bei gleichzeitigem
// Bearbeiten verloren). Die Standort-Klaerung wird hier nie geschrieben,
// das macht ausschliesslich klaerung-update.
//
// Zugriff nur mit gueltigem Token (dashboard-login).
// ====================================================================
const { zugriffPruefen, sitzungAus, CORS_HEADERS } = require('../lib/auth.cjs');
const { dbAktiv, anfragenLaden, anfragenSpeichern, anfragenLoeschen } = require('../lib/anfragen-db.cjs');

const MAX_KARTEN_PRO_AUFRUF = 200;

const antwort = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS_HEADERS },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return antwort(200, { success: true });
  const verweigert = zugriffPruefen(event);
  if (verweigert) return verweigert;
  if (!dbAktiv()) return antwort(500, { success: false, error: 'Server nicht konfiguriert (DATABASE_URL fehlt)' });

  try {
    if (event.httpMethod === 'GET') {
      const data = await anfragenLaden();
      return antwort(200, { success: true, data });
    }

    if (event.httpMethod === 'POST') {
      const sitzung = sitzungAus(event);
      if (sitzung.lesend) return antwort(403, { success: false, error: 'Nur Lesezugriff' });
      let payload;
      try { payload = JSON.parse(event.body || '{}'); } catch (e) { return antwort(400, { success: false, error: 'Ungültiges JSON' }); }

      // Altes Format (komplette Liste) bewusst ablehnen: ein noch offener,
      // veralteter Browser-Tab darf nicht mehr den ganzen Bestand schicken.
      if (Array.isArray(payload.anfragen)) {
        return antwort(409, { success: false, error: 'Veraltete Version – bitte Seite neu laden', code: 'RELOAD' });
      }
      const upsert = Array.isArray(payload.upsert) ? payload.upsert : [];
      const loeschen = Array.isArray(payload.loeschen) ? payload.loeschen.map(String).filter(Boolean) : [];
      if (upsert.length > MAX_KARTEN_PRO_AUFRUF || loeschen.length > MAX_KARTEN_PRO_AUFRUF) {
        return antwort(413, { success: false, error: 'Zu viele Änderungen auf einmal' });
      }
      const gespeichert = await anfragenSpeichern(upsert, { autor: sitzung.name });
      const geloescht = await anfragenLoeschen(loeschen);
      return antwort(200, { success: true, gespeichert, geloescht });
    }

    return antwort(405, { success: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('anfragen-api Fehler:', err);
    return antwort(500, { success: false, error: 'Datenbankfehler: ' + (err.message || 'unbekannt') });
  }
};

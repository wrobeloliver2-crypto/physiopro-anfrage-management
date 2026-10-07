// ====================================================================
// Netlify Function: dashboard-login
// Prueft das Dashboard-Kennwort SERVERSEITIG und gibt bei Erfolg ein
// signiertes, zeitlich begrenztes Token zurueck (siehe netlify/lib/auth.cjs).
// Das Kennwort steht damit nicht mehr im ausgelieferten JavaScript.
// ====================================================================
const { tokenErstellen, kennwortRichtig, CORS_HEADERS, geheimnis } = require('../lib/auth.cjs');

const antwort = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return antwort(200, { success: true });
  if (event.httpMethod !== 'POST') return antwort(405, { success: false, error: 'Method not allowed' });
  if (!geheimnis()) {
    return antwort(500, { success: false, error: 'Server nicht konfiguriert (DASHBOARD_TOKEN_SECRET fehlt)' });
  }
  let eingabe = '';
  try { eingabe = String(JSON.parse(event.body || '{}').kennwort || ''); } catch (e) { /* leer */ }
  if (!kennwortRichtig(eingabe)) {
    // kleine Bremse gegen Durchprobieren
    await new Promise((r) => setTimeout(r, 600));
    return antwort(401, { success: false, error: 'Kennwort falsch' });
  }
  return antwort(200, { success: true, token: tokenErstellen() });
};

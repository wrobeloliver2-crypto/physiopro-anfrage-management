// Netlify Function: kruse-list-anfragen
// Liefert alle Kruse-Datenanforderungsfälle für den Dashboard-Tab
// "Kruse-Anfragen" (StatusSpalte-Tab, analog zu Osteo-Termine).
//
// Hinweis: .cjs statt .js — siehe _kruse-lib.cjs (package.json "type":"module"
// sonst Runtime.HandlerNotFound für exports.handler).
const { sheetReadAll } = require('./_kruse-lib.cjs');

exports.handler = async (event) => {
  if (!process.env.KRUSE_SHEET_ID) {
    return resp(500, { error: 'Server nicht konfiguriert (KRUSE_SHEET_ID fehlt)' });
  }
  if (!process.env.KRUSE_GOOGLE_CLIENT_EMAIL || !process.env.KRUSE_GOOGLE_PRIVATE_KEY) {
    return resp(500, { error: 'Server nicht konfiguriert (KRUSE_GOOGLE_CLIENT_EMAIL/KRUSE_GOOGLE_PRIVATE_KEY fehlt)' });
  }

  try {
    const all = await sheetReadAll();
    const faelle = all.filter((a) => (a.status || 'Offen') !== 'Erledigt');
    const erledigt = all.filter((a) => a.status === 'Erledigt');
    return resp(200, { faelle, erledigt });
  } catch (e) {
    console.error('kruse-list-anfragen error:', e);
    return resp(500, { error: 'Konnte Kruse-Anfragen nicht laden.' });
  }
};

function resp(code, obj) {
  return {
    statusCode: code,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(obj),
  };
}

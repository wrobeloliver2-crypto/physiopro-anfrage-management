// Netlify Function: kruse-update-status
// Schreibt Statuswechsel/Notizen für einen Kruse-Datenanforderungsfall
// (Offen -> Angefordert -> Unterlagen vollständig -> Erledigt), inkl.
// History-Eintrag — analog zum historyEintrag()-Muster im Dashboard.
//
// Hinweis: .cjs statt .js — siehe _kruse-lib.cjs (package.json "type":"module"
// sonst Runtime.HandlerNotFound für exports.handler).
const { sheetReadAll, sheetUpdateRow } = require('./_kruse-lib.cjs');

const STATUS_FOLGE = ['Offen', 'Angefordert', 'Unterlagen vollständig', 'Erledigt'];

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return resp(405, { error: 'Method not allowed' });
  if (!process.env.KRUSE_SHEET_ID) {
    return resp(500, { error: 'Server nicht konfiguriert (KRUSE_SHEET_ID fehlt)' });
  }
  if (!process.env.KRUSE_GOOGLE_CLIENT_EMAIL || !process.env.KRUSE_GOOGLE_PRIVATE_KEY) {
    return resp(500, { error: 'Server nicht konfiguriert (KRUSE_GOOGLE_CLIENT_EMAIL/KRUSE_GOOGLE_PRIVATE_KEY fehlt)' });
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { id, status, bearbeiter, notiz } = body;
    if (!id) return resp(400, { error: 'id fehlt.' });
    if (status && !STATUS_FOLGE.includes(status)) return resp(400, { error: 'Ungültiger Status.' });

    const all = await sheetReadAll();
    const fall = all.find((f) => f.id === id);
    if (!fall) return resp(404, { error: 'Fall nicht gefunden.' });

    const zeitstempel = new Date().toISOString();
    const alterStatus = fall.status || 'Offen';
    const neuerStatus = status || alterStatus;
    const neuerBearbeiter = bearbeiter !== undefined && bearbeiter !== '' ? bearbeiter : fall.bearbeiter;
    const neueNotizen = notiz !== undefined ? notiz : fall.notizen;
    // angefordertAm wird beim ersten Wechsel auf "Angefordert" gesetzt und danach nicht mehr überschrieben.
    const angefordertAm = (neuerStatus === 'Angefordert' && !fall.angefordertAm) ? zeitstempel : fall.angefordertAm;

    const bisherigeHistory = Array.isArray(fall.history) ? fall.history : [];
    const neueEintraege = [];
    if (status && status !== alterStatus) {
      neueEintraege.push({
        zeitstempel, aktion: 'Status geändert', von: bearbeiter || fall.bearbeiter || '',
        details: `${alterStatus} → ${status}`,
      });
    }
    if (notiz !== undefined && notiz !== fall.notizen && notiz) {
      neueEintraege.push({
        zeitstempel, aktion: 'Notiz', von: bearbeiter || fall.bearbeiter || '', details: notiz,
      });
    }
    const neueHistory = [...bisherigeHistory, ...neueEintraege];

    const row = [
      fall.zeitstempel, fall.name, fall.geburtsdatum, fall.telefon, fall.hinweis,
      fall.id, neuerStatus, neuerBearbeiter || '', angefordertAm || '', neueNotizen || '',
      JSON.stringify(neueHistory),
    ];
    await sheetUpdateRow(fall._rowIndex, row);

    return resp(200, { ok: true, status: neuerStatus });
  } catch (e) {
    console.error('kruse-update-status error:', e);
    return resp(500, { error: 'Konnte Status nicht speichern.' });
  }
};

function resp(code, obj) {
  return {
    statusCode: code,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(obj),
  };
}

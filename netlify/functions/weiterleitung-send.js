// ====================================================================
// Netlify Function: weiterleitung-send
// Versendet eine Weiterleitungs-Mail an Oliver oder Hanna DIREKT
// (Graph sendMail) im Moment des Weiterleitens im Dashboard.
//
// Ersetzt den pollenden Power-Automate-Flow #2 (der alle 15 Min das
// ganze Sheet las und dadurch die Google-Verbindung drosselte).
// Hier: kein Sheet-Lesen — die Kartendaten kommen direkt aus dem
// Dashboard-Request.
//
// Aufruf: vom Dashboard (Browser) über die eigene Domain — wie sheets-api
// ohne API-Key (Schutz = Passwort-Gate + gleiche Domain). Der eigentliche
// Mehrfachversand-Schutz liegt in Spalte O (reminderStatus) im Dashboard.
// Postfach + App: dieselbe Graph-App wie draft-create (ba3319fd),
// jetzt mit Mail.Send. Access Policy beschränkt weiter auf info@.
// ====================================================================

const TENANT_ID = process.env.MS_TENANT_ID;
const CLIENT_ID = process.env.MS_DASHBOARD_CLIENT_ID;
const CLIENT_SECRET = process.env.MS_DASHBOARD_CLIENT_SECRET;
const MAILBOX = process.env.MS_DASHBOARD_MAILBOX || 'info@physioproluebeck.de';

// Ziel-Name → Empfängeradresse
const EMPFAENGER = {
  'Oliver Wrobel': 'oliver.wrobel@pilatescompany.de',
  'Hanna Wrobel': 'hanna.wrobel@pilatescompany.de',
};

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

// ---- Graph Access Token (Client Credentials Flow) ----
async function getToken() {
  const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error('Token-Fehler: ' + res.status + ' ' + text);
  }
  const data = await res.json();
  return data.access_token;
}

// ---- kleine HTML-Escape-Hilfe (gegen kaputtes Markup in Feldern) ----
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---- HTML-Mailvorlage (PhysioPro-Look) ----
function buildHtml({ an, name, telefon, email, anliegen, prioritaet, quelle, eingangsdatum, notizen }) {
  const gruen = '#55725e';
  const gruenHell = '#eef3f0';
  const beige = '#f7f0e8';
  const text = '#2f3b33';
  const grau = '#6b7770';
  const zeile = (label, wert) => wert
    ? `<tr><td style="padding:6px 0;font-size:14px;color:${grau};width:130px;vertical-align:top;">${label}</td><td style="padding:6px 0;font-size:14px;color:${text};font-weight:600;">${esc(wert)}</td></tr>`
    : '';
  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${beige};font-family:'Segoe UI',Arial,sans-serif;color:${text};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${beige};padding:28px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 14px rgba(85,114,94,.10);">
        <tr><td style="background:${gruen};padding:26px 34px;">
          <h1 style="margin:0;font-family:'Georgia',serif;font-size:22px;font-weight:600;color:#ffffff;">Weitergeleitete Anfrage</h1>
          <p style="margin:6px 0 0;font-size:13px;color:#d6e2db;">für ${esc(an)} · PhysioPro Rezeptionsdashboard</p>
        </td></tr>
        <tr><td style="padding:28px 34px 10px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${zeile('Name', name)}
            ${zeile('Telefon', telefon)}
            ${zeile('E-Mail', email)}
            ${zeile('Anliegen', anliegen)}
            ${zeile('Priorität', prioritaet)}
            ${zeile('Quelle', quelle)}
            ${zeile('Eingang', eingangsdatum)}
            ${zeile('Notizen', notizen)}
          </table>
        </td></tr>
        <tr><td style="padding:6px 34px 26px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${gruenHell};border-radius:10px;">
            <tr><td style="padding:14px 18px;font-size:13px;line-height:1.55;color:${grau};">
              Diese Anfrage wurde aus dem Rezeptionsdashboard an dich weitergeleitet. Sie ist dort aus dem Board verschwunden und liegt im Archiv.
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="background:${gruenHell};padding:16px 34px;border-top:1px solid #dde8e0;">
          <p style="margin:0;font-size:12px;line-height:1.7;color:${grau};">
            <strong style="color:${gruen};">PhysioPro Lübeck</strong> · Rezeptionsdashboard
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(200, { ok: true });
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
    return jsonResponse(500, {
      success: false,
      error: 'Mailer nicht konfiguriert (MS_TENANT_ID / MS_DASHBOARD_CLIENT_ID / MS_DASHBOARD_CLIENT_SECRET fehlt)',
    });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { success: false, error: 'Ungültiger Request-Body' });
  }

  const { an, name, telefon, email, anliegen, prioritaet, quelle, eingangsdatum, notizen } = payload;

  const empfaenger = EMPFAENGER[an];
  if (!empfaenger) {
    // Unbekanntes Ziel: nicht als Fehler behandeln (kein Flow-Retry), nur überspringen.
    return jsonResponse(200, { skipped: 'Unbekanntes Weiterleitungsziel: ' + String(an) });
  }

  try {
    const token = await getToken();

    const message = {
      subject: `Weitergeleitete Anfrage – ${name || 'ohne Namen'}`,
      body: {
        contentType: 'HTML',
        content: buildHtml({ an, name, telefon, email, anliegen, prioritaet, quelle, eingangsdatum, notizen }),
      },
      toRecipients: [{ emailAddress: { address: empfaenger } }],
    };

    // sendMail: versendet direkt aus dem Postfach info@ (kein Entwurf).
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/sendMail`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, saveToSentItems: true }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return jsonResponse(res.status, {
        success: false,
        error: 'Graph-Fehler beim Senden: ' + res.status,
        detail: detail.slice(0, 500),
      });
    }

    // sendMail liefert 202 Accepted ohne Body.
    return jsonResponse(200, { success: true, empfaenger, mailbox: MAILBOX });
  } catch (e) {
    return jsonResponse(500, { success: false, error: e.message || 'Unbekannter Fehler' });
  }
};

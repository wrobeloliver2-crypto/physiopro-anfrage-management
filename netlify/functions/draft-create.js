// ====================================================================
// Netlify Function: draft-create
// Erstellt einen HTML-E-Mail-ENTWURF mit optionalem PDF-Anhang im
// Praxispostfach (info@physioproluebeck.de) via Microsoft Graph API.
// Der Entwurf wird NICHT versendet — die Rezeption prüft & sendet in Outlook.
// ====================================================================

const TENANT_ID = process.env.MS_TENANT_ID;
const CLIENT_ID = process.env.MS_DASHBOARD_CLIENT_ID;
const CLIENT_SECRET = process.env.MS_DASHBOARD_CLIENT_SECRET;
const MAILBOX = process.env.MS_DASHBOARD_MAILBOX || 'info@physioproluebeck.de';

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

// ---- HTML-Mailvorlage (PhysioPro-Look) ----
function buildHtml({ name, behandlung }) {
  const gruen = '#55725e';
  const gruenHell = '#eef3f0';
  const beige = '#f7f0e8';
  const text = '#2f3b33';
  const grau = '#6b7770';
  return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${beige};font-family:'Segoe UI',Arial,sans-serif;color:${text};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${beige};padding:28px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 14px rgba(85,114,94,.10);">
        <!-- Kopf -->
        <tr><td style="background:${gruen};padding:30px 36px;">
          <h1 style="margin:0;font-family:'Georgia','Cormorant Garamond',serif;font-size:24px;font-weight:600;color:#ffffff;letter-spacing:.3px;">PhysioPro Lübeck</h1>
          <p style="margin:6px 0 0;font-size:13px;color:#d6e2db;">Physiotherapie &amp; Osteopathie</p>
        </td></tr>
        <!-- Inhalt -->
        <tr><td style="padding:34px 36px 12px;">
          <p style="margin:0 0 18px;font-size:16px;">Liebe/r ${name},</p>
          <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:${text};">
            vielen Dank für Ihre Anfrage bei PhysioPro Lübeck.
          </p>
          <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:${text};">
            wir freuen uns, Ihnen mitteilen zu können, dass wir einen Termin für Sie
            im Bereich <strong style="color:${gruen};">${behandlung}</strong> vereinbaren konnten.
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${gruenHell};border-radius:10px;margin:0 0 22px;">
            <tr><td style="padding:16px 20px;font-size:14px;line-height:1.55;color:${grau};">
              📎 Ihre genauen <strong style="color:${gruen};">Termindetails</strong> finden Sie im
              <strong>PDF-Anhang</strong> dieser E-Mail.
            </td></tr>
          </table>
          <p style="margin:0 0 6px;font-size:15px;line-height:1.6;color:${text};">
            Bei Fragen erreichen Sie uns jederzeit gerne telefonisch oder per E-Mail.
          </p>
        </td></tr>
        <!-- Gruß -->
        <tr><td style="padding:8px 36px 30px;">
          <p style="margin:0 0 2px;font-size:15px;color:${text};">Mit freundlichen Grüßen</p>
          <p style="margin:0;font-size:15px;font-weight:600;color:${gruen};">Ihr PhysioPro-Team</p>
        </td></tr>
        <!-- Fuß -->
        <tr><td style="background:${gruenHell};padding:20px 36px;border-top:1px solid #dde8e0;">
          <p style="margin:0;font-size:12px;line-height:1.7;color:${grau};">
            <strong style="color:${gruen};">PhysioPro Lübeck</strong><br>
            Tel: 0451 – 400 430 70<br>
            <a href="mailto:info@physioproluebeck.de" style="color:${gruen};text-decoration:none;">info@physioproluebeck.de</a><br>
            <a href="https://www.physioproluebeck.de" style="color:${gruen};text-decoration:none;">www.physioproluebeck.de</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
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

  const { name, email, behandlung, pdfBase64, pdfName } = payload;
  if (!email) return jsonResponse(400, { success: false, error: 'Empfänger-E-Mail fehlt' });

  const empfaengerName = name || 'Patient/in';
  const fach = behandlung || 'Physiotherapie';

  try {
    const token = await getToken();

    // Entwurf-Objekt
    const message = {
      subject: 'Ihre Terminbestätigung – PhysioPro Lübeck',
      body: {
        contentType: 'HTML',
        content: buildHtml({ name: empfaengerName, behandlung: fach }),
      },
      toRecipients: [{ emailAddress: { address: email } }],
    };

    // Optionaler PDF-Anhang
    if (pdfBase64) {
      message.attachments = [{
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: pdfName || 'Terminbestaetigung.pdf',
        contentType: 'application/pdf',
        contentBytes: pdfBase64,
      }];
    }

    // Entwurf im Postfach erstellen (POST /messages = Draft, NICHT sendMail)
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    if (!res.ok) {
      const text = await res.text();
      return jsonResponse(res.status, {
        success: false,
        error: 'Graph-Fehler beim Entwurf: ' + res.status,
        detail: text.slice(0, 500),
      });
    }

    const draft = await res.json();
    return jsonResponse(200, {
      success: true,
      draftId: draft.id,
      webLink: draft.webLink || null,
      mailbox: MAILBOX,
    });
  } catch (e) {
    return jsonResponse(500, { success: false, error: e.message || 'Unbekannter Fehler' });
  }
};

import type { Context, Config } from "@netlify/functions";
import { GoogleAuth } from "google-auth-library";
import { google } from "googleapis";

// Diese Function verwaltet die Dringlichkeits-Priorisierung eines
// Anfrage-Eintrags im PhysioPro Google Sheet, ausgelöst über einen
// Link in der Placetel-SMS.
//
// Zwei-Phasen-Ablauf (damit bloßes Öffnen nichts auslöst):
//  - GET  /priority-update?tel=<nummer>  -> zeigt eine Seite mit der
//    Frage "Ist es dringend?" und einem Button. Es wird NICHTS geschrieben.
//  - POST /priority-update?tel=<nummer>  -> erst hier wird der neueste
//    passende Sheet-Eintrag gesucht und dessen Priorität auf "Sofort" gesetzt.
//
// Echte Sheet-Spalten (verifiziert): "ID", "Telefon", "Priorität"
// Tab-Name (verifiziert): "Tabellenblatt1"
//
// Übernommen aus dem eigenständigen Projekt physiopro-prioritaet
// (dort ohne Git-Repo, nur Upload-Deploy) ins Dashboard-Repo.
// Angepasst: Netlify.env.get(...) -> process.env, damit es zum Stil
// der übrigen Functions in diesem Repo passt (GOOGLE_SHEET_ID /
// GOOGLE_SERVICE_ACCOUNT sind hier bereits identisch gesetzt wie im
// Ursprungsprojekt).

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_TAB_NAME = process.env.GOOGLE_SHEET_TAB_NAME || "Tabellenblatt1";
const SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT;

function normalizePhone(raw: string): string {
  let digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = "49" + digits.slice(1);
  return digits;
}

function columnIndexToLetter(index: number): string {
  let letter = "";
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

function pageShell(title: string, badge: string, badgeColor: string, bodyHtml: string): Response {
  const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} – PhysioPro Lübeck</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background:#faf7f2; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
  .card { background:#fff; border-radius:16px; padding:40px 32px; max-width:420px; text-align:center; box-shadow:0 4px 24px rgba(0,0,0,0.06); }
  h1 { font-size:22px; color:#2c2c2c; margin:0 0 12px; }
  p { color:#555; line-height:1.5; }
  .badge { display:inline-block; background:${badgeColor}; color:#fff; border-radius:999px; padding:6px 16px; font-size:14px; margin-bottom:16px; }
  .footer { margin-top:24px; font-size:13px; color:#999; }
  button { background:#4a6741; color:#fff; border:none; border-radius:999px; padding:14px 28px; font-size:16px; font-weight:600; cursor:pointer; margin-top:8px; width:100%; }
  button:active { opacity:0.85; }
  .sub { font-size:13px; color:#999; margin-top:14px; }
</style>
</head>
<body>
  <div class="card">
    <div class="badge">${badge}</div>
    ${bodyHtml}
    <div class="footer">physioproluebeck.de · Tel. 0451 – 400 730 73</div>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const telRaw = url.searchParams.get("tel");

  // --- Phase 1: GET -> nur die Frage-Seite mit Button anzeigen, nichts schreiben ---
  if (req.method !== "POST") {
    if (!telRaw) {
      return pageShell(
        "Link unvollständig",
        "Hinweis",
        "#a4453a",
        `<h1>Link unvollständig</h1><p>Diesem Link fehlt eine Information. Bitte rufen Sie uns direkt an, falls Ihr Anliegen dringend ist.</p>`
      );
    }
    const safeTel = telRaw.replace(/[^\d+]/g, "");
    return pageShell(
      "Ist Ihr Anliegen dringend?",
      "PhysioPro Lübeck",
      "#4a6741",
      `<h1>Ist Ihr Anliegen dringend?</h1>
       <p>Wenn es dringend ist, markieren wir Ihre Anfrage bevorzugt. Sonst müssen Sie nichts tun – wir melden uns ohnehin bei Ihnen.</p>
       <form method="POST" action="/priority-update?tel=${encodeURIComponent(safeTel)}">
         <button type="submit">Ja, es ist dringend</button>
       </form>
       <div class="sub">Kein Klick nötig, wenn es nicht eilt.</div>`
    );
  }

  // --- Phase 2: POST -> tatsächlich hochstufen ---
  if (!telRaw) {
    return pageShell("Link unvollständig", "Hinweis", "#a4453a",
      `<h1>Link unvollständig</h1><p>Bitte rufen Sie uns direkt an, falls es dringend ist.</p>`);
  }

  if (!SHEET_ID || !SERVICE_ACCOUNT_JSON) {
    console.error("Missing GOOGLE_SHEET_ID or GOOGLE_SERVICE_ACCOUNT env vars");
    return pageShell("Technisches Problem", "Hinweis", "#a4453a",
      `<h1>Technisches Problem</h1><p>Ihre Anfrage konnte gerade nicht verarbeitet werden. Bitte rufen Sie uns direkt an.</p>`);
  }

  const targetPhone = normalizePhone(telRaw);

  try {
    const credentials = JSON.parse(SERVICE_ACCOUNT_JSON);
    const auth = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });

    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: SHEET_TAB_NAME,
    });

    const rows = readRes.data.values || [];
    if (rows.length < 2) {
      return pageShell("Kein Eintrag gefunden", "Hinweis", "#a4453a",
        `<h1>Kein Eintrag gefunden</h1><p>Wir konnten Ihre Anfrage nicht automatisch finden. Bitte rufen Sie uns direkt an, wenn es dringend ist.</p>`);
    }

    const header = rows[0];
    const idCol = header.indexOf("ID");
    const phoneCol = header.indexOf("Telefon");
    const prioCol = header.indexOf("Priorität");

    if (idCol === -1 || phoneCol === -1 || prioCol === -1) {
      console.error("Expected columns (ID, Telefon, Priorität) not found:", header);
      return pageShell("Technisches Problem", "Hinweis", "#a4453a",
        `<h1>Technisches Problem</h1><p>Ihre Anfrage konnte gerade nicht verarbeitet werden. Bitte rufen Sie uns direkt an.</p>`);
    }

    // Neuesten passenden Eintrag finden (letzter Treffer = jüngster, da chronologisch angehängt)
    let matchRowIndex = -1;
    let matchId = "";
    for (let i = 1; i < rows.length; i++) {
      const rowPhone = normalizePhone(String(rows[i][phoneCol] || ""));
      if (rowPhone && rowPhone === targetPhone) {
        matchRowIndex = i;
        matchId = String(rows[i][idCol] || "");
      }
    }

    if (matchRowIndex === -1) {
      return pageShell("Kein Eintrag gefunden", "Hinweis", "#a4453a",
        `<h1>Kein Eintrag gefunden</h1><p>Wir konnten Ihre Anfrage nicht automatisch finden. Bitte rufen Sie uns direkt an, wenn es dringend ist.</p>`);
    }

    const sheetRowNumber = matchRowIndex + 1;
    const colLetter = columnIndexToLetter(prioCol);
    const targetRange = `${SHEET_TAB_NAME}!${colLetter}${sheetRowNumber}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: targetRange,
      valueInputOption: "RAW",
      requestBody: { values: [["Sofort"]] },
    });

    console.log(`Priority set to Sofort for entry ${matchId} (row ${sheetRowNumber})`);

    return pageShell(
      "Als dringend markiert",
      "Erledigt",
      "#4a6741",
      `<h1>Danke, wir kümmern uns bevorzugt darum</h1><p>Ihr Anliegen wurde als dringend markiert. Annika und ihr Team melden sich schnellstmöglich bei Ihnen.</p>`
    );
  } catch (err) {
    console.error("priority-update error:", err);
    return pageShell("Technisches Problem", "Hinweis", "#a4453a",
      `<h1>Technisches Problem</h1><p>Ihre Anfrage konnte gerade nicht verarbeitet werden. Bitte rufen Sie uns direkt an.</p>`);
  }
};

export const config: Config = {
  path: "/priority-update",
};

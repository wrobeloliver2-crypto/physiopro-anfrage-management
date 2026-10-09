// ====================================================================
// Netlify Function: nachricht-api
// Interne Nachrichten zwischen den angemeldeten Mitarbeiter:innen
// (an eine Person oder an einen ganzen Standort). Jede Nachricht ist
// eine eigene Karte im Board (Quelle "Interne Nachricht"), der Verlauf
// liegt in der Spalte `nachricht` (jsonb).
//
//   POST { aktion: 'senden', an, standort, betreff, text, dringend }
//        an = { typ: 'person', id, name } | { typ: 'standort', standort }
//        -> legt die Karte an, Absender = angemeldete Person
//   POST { aktion: 'antwort', id, text }
//        -> haengt eine Antwort an; eine erledigte Karte wird wieder offen
//           (nachricht.geschlossen und nachricht.quittiert werden entfernt)
//   POST { aktion: 'gelesen', id }
//        -> merkt, dass die angemeldete Person den Stand gesehen hat
//   POST { aktion: 'schliessen', id }
//        -> Karte auf Erledigt setzen, protokolliert (nachricht.geschlossen +
//           history). Regel siehe lib/nachricht-regeln.cjs: Der Absender darf
//           immer, sonst nur, wer NICHT den letzten Verlaufseintrag geschrieben
//           hat. Schliesst der Empfaenger, muss der Absender per 'quittieren'
//           bestaetigen. Nicht fuer Nur-Lese-Zugang.
//   POST { aktion: 'quittieren', id }
//        -> Absender bestaetigt „Zur Kenntnis genommen" (nachricht.quittiert);
//           auch fuer Nur-Lese-Zugang erlaubt.
//
// Feldgranular: Es werden nur nachricht, history (ein Eintrag) und beim
// Wieder-Oeffnen status/ergebnis geschrieben – atomar in einem UPDATE.
// anfragen-api schreibt die Spalte nachricht nie.
//
// Zugriff nur mit gueltigem Token (dashboard-login). Nur-Lese-Zugang darf
// lesen und "gelesen" setzen, aber nicht senden oder antworten.
// ====================================================================
const crypto = require('crypto');
const { zugriffPruefen, sitzungAus, CORS_HEADERS } = require('../lib/auth.cjs');
const { dbAktiv, sql } = require('../lib/anfragen-db.cjs');
const { darfNachrichtSchliessen } = require('../lib/nachricht-regeln.cjs');

const QUELLE = 'Interne Nachricht';
const ERGEBNIS_NACHRICHT = 'Interne Nachricht'; // wie beim bisherigen Erledigt-Button im Dashboard
const STANDORTE = { 'bad-schwartau': 'Bad Schwartau', stockelsdorf: 'Stockelsdorf' };
const MAX_TEXT = 2000;
const MAX_BETREFF = 120;
const MAX_VERLAUF = 100;

const antwort = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS_HEADERS },
  body: JSON.stringify(body),
});

const text = (v, max) => String(v == null ? '' : v).replace(/\r\n/g, '\n').trim().slice(0, max);

function heuteBerlin() {
  // YYYY-MM-DD in deutscher Zeit (wie eingangsdatum der anderen Wege)
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
}

function neueId() {
  return 'msg-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return antwort(200, { success: true });
  if (event.httpMethod !== 'POST') return antwort(405, { success: false, error: 'Method not allowed' });
  const verweigert = zugriffPruefen(event);
  if (verweigert) return verweigert;
  if (!dbAktiv()) return antwort(500, { success: false, error: 'Server nicht konfiguriert (DATABASE_URL fehlt)' });

  const sitzung = sitzungAus(event);
  const ich = { id: String(sitzung.mf || ''), name: text(sitzung.name, 120) };
  if (!ich.id) return antwort(401, { success: false, error: 'Anmeldung ohne Person', code: 'AUTH' });

  let p;
  try { p = JSON.parse(event.body || '{}'); } catch (e) { return antwort(400, { success: false, error: 'Ungültiges JSON' }); }
  const aktion = String(p.aktion || '');
  const jetzt = new Date().toISOString();

  try {
    // ---------------- gelesen ----------------
    if (aktion === 'gelesen') {
      const id = text(p.id, 100);
      if (!id) return antwort(400, { success: false, error: 'id fehlt' });
      const r = await sql().query(
        `UPDATE anfragen
            SET nachricht = jsonb_set(nachricht, '{gelesen}',
                  COALESCE(nachricht->'gelesen', '{}'::jsonb) || jsonb_build_object($2::text, $3::text))
          WHERE id = $1 AND nachricht IS NOT NULL
          RETURNING id`,
        [id, ich.id, jetzt]
      );
      if (!r.length) return antwort(404, { success: false, error: 'Nachricht nicht gefunden' });
      return antwort(200, { success: true });
    }

    // ---------------- quittieren ----------------
    // Absender bestaetigt, dass er die Schliessung durch den Empfaenger gesehen hat.
    if (aktion === 'quittieren') {
      const id = text(p.id, 100);
      if (!id) return antwort(400, { success: false, error: 'id fehlt' });
      const zeilen = await sql().query('SELECT nachricht FROM anfragen WHERE id = $1 AND nachricht IS NOT NULL', [id]);
      if (!zeilen.length) return antwort(404, { success: false, error: 'Nachricht nicht gefunden' });
      const n = zeilen[0].nachricht || {};
      if (!n.von || String(n.von.id) !== ich.id) {
        return antwort(403, { success: false, error: 'Nur der Absender kann „Zur Kenntnis" bestätigen' });
      }
      await sql().query(
        `UPDATE anfragen
            SET nachricht = jsonb_set(nachricht, '{quittiert}',
                  COALESCE(nachricht->'quittiert', '{}'::jsonb) || jsonb_build_object($2::text, $3::text))
          WHERE id = $1 AND nachricht IS NOT NULL`,
        [id, ich.id, jetzt]
      );
      return antwort(200, { success: true });
    }

    if (sitzung.lesend) return antwort(403, { success: false, error: 'Nur Lesezugriff' });

    // ---------------- schliessen ----------------
    if (aktion === 'schliessen') {
      const id = text(p.id, 100);
      if (!id) return antwort(400, { success: false, error: 'id fehlt' });
      const zeilen = await sql().query('SELECT status, nachricht FROM anfragen WHERE id = $1 AND nachricht IS NOT NULL', [id]);
      if (!zeilen.length) return antwort(404, { success: false, error: 'Nachricht nicht gefunden' });
      const n = zeilen[0].nachricht || {};
      if (zeilen[0].status === 'Erledigt') {
        return antwort(409, { success: false, error: 'Die Nachricht ist bereits erledigt', code: 'BEREITS_ERLEDIGT' });
      }
      const darf = darfNachrichtSchliessen(n, ich.id);
      if (!darf.erlaubt) return antwort(403, { success: false, error: darf.grund, code: 'WARTET', wartetAuf: darf.wartetAuf });
      const istAbsender = String(n.von.id) === ich.id;
      const anzahl = Array.isArray(n.verlauf) ? n.verlauf.length : 0;
      const geschlossen = { von: ich, zeit: jetzt };
      const quittiert = istAbsender ? { [ich.id]: jetzt } : {};
      const hist = { zeitstempel: jetzt, aktion: 'Status', von: ich.name, details: 'Erledigt (Nachricht geschlossen von ' + ich.name + ')' };
      // Atomar; die Bedingung auf Verlaufslaenge und Status verhindert, dass eine
      // zwischenzeitlich eingegangene Antwort ueberschrieben/uebergangen wird.
      const r = await sql().query(
        `UPDATE anfragen
            SET status = 'Erledigt',
                ergebnis = $6,
                nachricht = jsonb_set(jsonb_set(nachricht, '{geschlossen}', $3::jsonb), '{quittiert}', $4::jsonb),
                history = COALESCE(history, '[]'::jsonb) || jsonb_build_array($5::jsonb),
                geaendert_am = now()
          WHERE id = $1 AND nachricht IS NOT NULL AND status <> 'Erledigt'
            AND jsonb_array_length(COALESCE(nachricht->'verlauf', '[]'::jsonb)) = $2::int
          RETURNING id`,
        [id, anzahl, JSON.stringify(geschlossen), JSON.stringify(quittiert), JSON.stringify(hist), ERGEBNIS_NACHRICHT]
      );
      if (!r.length) {
        return antwort(409, { success: false, error: 'Die Nachricht wurde inzwischen geändert – bitte die Ansicht aktualisieren und erneut versuchen', code: 'GEAENDERT' });
      }
      return antwort(200, { success: true, id, geschlossen, quittiert });
    }

    // ---------------- senden ----------------
    if (aktion === 'senden') {
      const betreff = text(p.betreff, MAX_BETREFF);
      const inhalt = text(p.text, MAX_TEXT);
      if (!betreff) return antwort(400, { success: false, error: 'Betreff fehlt' });
      if (!inhalt) return antwort(400, { success: false, error: 'Text fehlt' });

      const anRoh = p.an && typeof p.an === 'object' ? p.an : {};
      let an;
      let standort = String(p.standort || '');
      if (anRoh.typ === 'standort') {
        const s = String(anRoh.standort || '');
        if (!STANDORTE[s]) return antwort(400, { success: false, error: 'Unbekannter Standort' });
        an = { typ: 'standort', standort: s, name: STANDORTE[s] };
        standort = s; // Standort-Nachricht liegt immer beim Ziel-Standort
      } else if (anRoh.typ === 'person') {
        const pid = String(anRoh.id || '').replace(/[^0-9]/g, '');
        const pname = text(anRoh.name, 120);
        if (!pid || !pname) return antwort(400, { success: false, error: 'Empfänger fehlt' });
        if (pid === ich.id) return antwort(400, { success: false, error: 'Nachricht an sich selbst nicht möglich' });
        an = { typ: 'person', id: pid, name: pname };
        if (!STANDORTE[standort]) return antwort(400, { success: false, error: 'Standort fehlt' });
      } else {
        return antwort(400, { success: false, error: 'Empfänger fehlt' });
      }

      const nachricht = {
        von: ich,
        an,
        verlauf: [{ zeit: jetzt, autorId: ich.id, autor: ich.name, text: inhalt }],
        gelesen: { [ich.id]: jetzt },
      };
      const id = neueId();
      const history = [{ zeitstempel: jetzt, aktion: 'Erstellt', von: ich.name, details: 'Interne Nachricht an ' + an.name }];
      await sql().query(
        `INSERT INTO anfragen (id, eingangsdatum, quelle, name, anliegen, prioritaet, status, bearbeiter, standort, history, nachricht)
         VALUES ($1, $2, $3, $4, $5, $6, 'Offen', $7, $8, $9::jsonb, $10::jsonb)`,
        [id, heuteBerlin(), QUELLE, betreff, inhalt, p.dringend ? 'Sofort' : 'Normal',
          an.typ === 'person' ? an.name : 'Unzugewiesen', standort,
          JSON.stringify(history), JSON.stringify(nachricht)]
      );
      return antwort(200, { success: true, id });
    }

    // ---------------- antwort ----------------
    if (aktion === 'antwort') {
      const id = text(p.id, 100);
      const inhalt = text(p.text, MAX_TEXT);
      if (!id) return antwort(400, { success: false, error: 'id fehlt' });
      if (!inhalt) return antwort(400, { success: false, error: 'Text fehlt' });
      const eintrag = { zeit: jetzt, autorId: ich.id, autor: ich.name, text: inhalt };
      const hist = { zeitstempel: jetzt, aktion: 'Nachricht', von: ich.name, details: 'Antwort: ' + inhalt.slice(0, 300) };
      // Verlauf anhaengen (auf die letzten MAX_VERLAUF Eintraege begrenzt),
      // als gelesen fuer die antwortende Person markieren. Ist die Karte
      // schon erledigt, wird sie wieder offen – sonst sieht niemand die Antwort.
      const r = await sql().query(
        `UPDATE anfragen
            SET nachricht = jsonb_set(
                  jsonb_set(nachricht - 'geschlossen' - 'quittiert', '{verlauf}', (
                    SELECT COALESCE(jsonb_agg(e ORDER BY nr), '[]'::jsonb) FROM (
                      SELECT e, nr FROM jsonb_array_elements(COALESCE(nachricht->'verlauf', '[]'::jsonb) || jsonb_build_array($2::jsonb))
                        WITH ORDINALITY AS t(e, nr)
                      ORDER BY nr DESC LIMIT ${MAX_VERLAUF}
                    ) x)),
                  '{gelesen}', COALESCE(nachricht->'gelesen', '{}'::jsonb) || jsonb_build_object($3::text, $4::text)),
                history = history || CASE WHEN status = 'Erledigt'
                  THEN jsonb_build_array($5::jsonb, jsonb_build_object('zeitstempel', $4::text, 'aktion', 'Status', 'von', $6::text, 'details', 'Erledigt → Offen (neue Antwort)'))
                  ELSE jsonb_build_array($5::jsonb) END,
                ergebnis = CASE WHEN status = 'Erledigt' THEN '' ELSE ergebnis END,
                status = CASE WHEN status = 'Erledigt' THEN 'Offen' ELSE status END,
                geaendert_am = now()
          WHERE id = $1 AND nachricht IS NOT NULL
          RETURNING id, status`,
        [id, JSON.stringify(eintrag), ich.id, jetzt, JSON.stringify(hist), ich.name]
      );
      if (!r.length) return antwort(404, { success: false, error: 'Nachricht nicht gefunden' });
      return antwort(200, { success: true, id, status: r[0].status });
    }

    return antwort(400, { success: false, error: 'Unbekannte Aktion' });
  } catch (err) {
    console.error('nachricht-api Fehler:', err);
    return antwort(500, { success: false, error: 'Datenbankfehler: ' + (err.message || 'unbekannt') });
  }
};

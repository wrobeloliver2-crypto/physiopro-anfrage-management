# Deployment-Anleitung

Diese Anleitung beschreibt die Schritte, um das PhysioPro Anfrage-Management
produktiv zu schalten. Schritte mit (DU) muessen aus Sicherheitsgruenden manuell
ausgefuehrt werden (Konten, Secrets, Berechtigungen).

## 1. Google Sheet vorbereiten (DU)

1. Neue Google-Tabelle anlegen, Tab "Sheet1".
2. Kopfzeile (Zeile 1) mit den Spalten A-O anlegen:
   ID, Eingangsdatum, Quelle, Name, Telefon, Email, Anliegen, Prioritaet,
   Status, Bearbeiter, FollowupDatum, FollowupZeit, Notizen, History, ReminderStatus
3. Sheet-ID aus der URL notieren
   (`https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit`).

## 2. Google Service Account erstellen (DU)

1. In der Google Cloud Console ein Projekt anlegen/auswaehlen.
2. Google Sheets API aktivieren.
3. Service Account erstellen und einen JSON-Key herunterladen.
4. Die Service-Account-E-Mail im Google Sheet als Bearbeiter freigeben
   (Sheet teilen mit der client_email aus dem JSON).

> Den JSON-Key NICHT ins Repository legen. Er kommt nur in die Netlify-Env-Variable.

## 3. Netlify Site verbinden (DU)

1. Bei Netlify einloggen und "Add new site > Import an existing project" waehlen.
2. GitHub autorisieren und das Repo `physiopro-anfrage-management` auswaehlen.
3. Build-Settings (werden aus `netlify.toml` gelesen):
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`

## 4. Environment Variables setzen (DU)

Unter *Site settings > Environment variables*:

| Variable               | Wert                                          |
| ---------------------- | --------------------------------------------- |
| GOOGLE_SHEET_ID        | (Sheet-ID aus Schritt 1)                      |
| GOOGLE_SERVICE_ACCOUNT | (kompletter JSON-Key als einzeiliger String)  |
| NODE_ENV               | production                                    |

## 5. Deploy

Nach dem Verbinden deployt Netlify automatisch bei jedem Push auf `main`.
Den ersten Build im Netlify-Dashboard pruefen (keine Fehler) und die Live-URL testen.

## 6. Power Automate (DU)

Die drei Flows gemaess `docs/power-automate.md` anlegen und aktivieren.
Verbindungen/Secrets ueber die geschuetzten Power-Automate-Connections verwalten.

## 7. Abnahme-Checkliste

- [ ] App laedt, Kanban-Board mit 4 Spalten sichtbar
- [ ] Neue Anfrage erfassen schreibt Zeile ins Google Sheet
- [ ] Status-Wechsel funktioniert (nur linearer Flow)
- [ ] Read-only-Modus fuer Hanna/Oliver greift
- [ ] Reminder-Flow sendet bei faelligem Follow-up
- [ ] Tages-Summary kommt an die Leads

## Sicherheits-Checkliste

- [ ] `.env` und Service-Account-JSON sind in `.gitignore` (nicht committet)
- [ ] Repository ist privat
- [ ] Secrets liegen ausschliesslich in Netlify- bzw. Power-Automate-Variablen

---

Fragen: oliver@physioproluebeck.de

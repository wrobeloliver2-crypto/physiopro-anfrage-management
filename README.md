# PhysioPro Anfrage-Management

Web-basiertes Anfrage-Management-System fuer die Rezeption von **PhysioPro Luebeck**.
Kanban-Board Dashboard mit Google Sheets als Datenbank, Netlify Functions als Backend
und Microsoft Power Automate fuer E-Mail-Verarbeitung und Reminder.

## Tech Stack

| Bereich     | Technologie                              |
| ----------- | ---------------------------------------- |
| Frontend    | React 18 + Tailwind CSS + Vite           |
| Backend     | Netlify Functions (Node.js)              |
| Datenbank   | Google Sheets API v4 (Service Account)   |
| Deployment  | Netlify (Git Auto-Deploy)                |
| Automation  | Microsoft Power Automate                 |
| Auth        | Session-based (localStorage)             |

## Features

- Kanban-Board mit 4 Spalten (Neu, Angeboten, In Bearbeitung, Erledigt)
- Linearer Status-Flow (nur ein Schritt vorwaerts erlaubt)
- Detail-/Edit-Modal mit Prioritaet, Bearbeiter, Follow-up und Notizen
- Neue-Anfrage-Formular mit Duplikat-Erkennung (Merge moeglich)
- Aufklappbare Aenderungs-History pro Anfrage
- Rollen-basierte Rechte: Rezeption editierbar, Hanna/Oliver read-only
- Auto-Save in Google Sheets
- 3 Power-Automate-Workflows (E-Mail-Erfassung, Reminder, Tages-Summary)

## Projekt-Struktur

```
physiopro-anfrage-management/
  index.html
  package.json
  vite.config.js
  tailwind.config.js
  postcss.config.js
  netlify.toml
  .env.example          # Vorlage (KEINE echten Secrets)
  src/
    main.jsx
    index.css
    App.jsx             # komplette React-App
  netlify/functions/
    sheets-api.js       # Google Sheets API (GET/POST)
  docs/
    deployment.md       # Schritt-fuer-Schritt Deployment
    power-automate.md    # Dokumentation der 3 Flows
```

## Lokale Entwicklung

```bash
npm install
npm run dev      # Vite Dev-Server auf http://localhost:5173
npm run build    # Production-Build nach dist/
```

> Die Netlify Function laeuft nur in der Netlify-Umgebung bzw. via Netlify CLI
> (`netlify dev`). Lokal sollten die Environment Variables gesetzt sein.

## Konfiguration / Secrets

Die folgenden Werte werden **im Netlify-Dashboard** unter
*Site settings > Environment variables* gesetzt - NICHT im Repository:

| Variable                  | Beschreibung                                   |
| ------------------------- | ---------------------------------------------- |
| GOOGLE_SHEET_ID           | ID der Google-Tabelle (aus der URL)            |
| GOOGLE_SERVICE_ACCOUNT    | Service-Account-JSON als einzeiliger String    |
| NODE_ENV                  | production                                     |

Siehe `docs/deployment.md` fuer die vollstaendige Anleitung.

## API

`/.netlify/functions/sheets-api`

- **GET**: liest alle Anfragen -> `{ success, data: [...] }`
- **POST**: schreibt die komplette Anfragen-Liste -> `{ success, message }`

## Datenschema (Google Sheet "Sheet1", Spalten A-O)

A ID | B Eingangsdatum | C Quelle | D Name | E Telefon | F Email |
G Anliegen | H Prioritaet | I Status | J Bearbeiter | K FollowupDatum |
L FollowupZeit | M Notizen | N History (JSON) | O ReminderStatus

## Lizenz / Verwendung

Internes Projekt fuer PhysioPro Luebeck. Kontakt: oliver@physioproluebeck.de

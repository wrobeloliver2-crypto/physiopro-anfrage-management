# PhysioPro Rezeptionsdashboard — Projektdokumentation

**Stand:** 19. Juni 2026
**Status:** Produktiv im Einsatz (Dashboard + Flow #1 + Weiterleitungs-Flow live)

---

## 1. Überblick

Das Rezeptionsdashboard ist die zentrale Arbeitsfläche der PhysioPro-Rezeption
zur Verwaltung eingehender Anfragen. Eingehende Anfragen (Website-Formular und
Telefon-KI) landen automatisch im Dashboard, werden dort von der Rezeption
bearbeitet, weitergeleitet oder abgeschlossen — und beim Schichtwechsel über
Übergabe-Notizen an die nächste Kraft übergeben.

**Charakter:** Vollbild-Webanwendung im Browser (keine Desktop-App). Die
Rezeption hat den Tab als Lesezeichen/Startseite offen. Oliver und Hanna lesen
nur mit (Read-Only); die Rezeption (Luca, Finn, Annika) bearbeitet.

---

## 2. Architektur

```
┌─────────────────────────────────────────────────────────────┐
│  EINGANG                                                     │
│  info@physioproluebeck.de (Shared Mailbox)                  │
│    ├─ Website-Formular   (formresponses@netlify.com)        │
│    └─ Telefon-KI         (no-reply@aipro.placetel.de)       │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  POWER AUTOMATE — Flow #1 (E-Mail → Sheet)                  │
│  Parst die Mail, schreibt Zeile mit Status "Offen"          │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  GOOGLE SHEET (Datenbank)                                    │
│  ID: 18IjuUk_wq7k9MZFLiT4KvfbLVgRw-uGbDnhgLJvkGnw           │
│  Tab: Tabellenblatt1                                         │
└───────────────────────────┬─────────────────────────────────┘
                            │  ▲
                  liest     │  │  schreibt (über Service-Account)
                            ▼  │
┌─────────────────────────────────────────────────────────────┐
│  NETLIFY FUNCTIONS (Backend, Service-Key serverseitig)      │
│  sheets-api.js  (Anfragen)   notes-api.js (Übergabe-Notizen)│
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  REACT-DASHBOARD (Vollbild-Webanwendung)                    │
│  leadmanagementphysiopro.netlify.app                        │
└─────────────────────────────────────────────────────────────┘

  PARALLEL: Weiterleitungs-Flow (Power Automate)
  Erkennt Status "Weitergeleitet" → Mail an Oliver/Hanna
```

**Wichtige Design-Entscheidung:** Das Dashboard spricht das Google Sheet nie
direkt an, sondern über die Netlify-Functions. Der Google-Service-Account-Key
bleibt damit serverseitig und gelangt nie in den Browser/die App.

---

## 3. Komponenten & Ressourcen

### Hosting & Code
- **Netlify-Site:** `leadmanagementphysiopro`, Site-ID `68b55e5d-730f-4bbb-8bd0-53523eac7bdc`
- **Live-URL:** https://leadmanagementphysiopro.netlify.app
- **GitHub-Repo:** `wrobeloliver2-crypto/physiopro-anfrage-management` (privat)
- **Deploy:** Git-Push auf `main` → Netlify baut automatisch

### Google
- **Anfrage-Sheet:** `18IjuUk_wq7k9MZFLiT4KvfbLVgRw-uGbDnhgLJvkGnw`, Tab `Tabellenblatt1`
- **Notizen-Sheet:** `1oCUHh8cN8XWGUAu-ESeFQErAL08aG9HEnkaXEZqycVg`
- **Service-Account:** `physiopro-anfrage@physiopro-anfrage-tool.iam.gserviceaccount.com`
  (Bearbeiter-Rechte auf beide Sheets)

### Microsoft 365 / Power Automate
- **Tenant:** `84c5926a`, Umgebung „Physio Pro Lübeck (default)"
- **Konto:** `oliver.wrobel@pilatescompany.de`
- **Mailbox:** `info@physioproluebeck.de` (Shared Mailbox)

---

## 4. Das Google Sheet — Spaltenschema

Der Tab `Tabellenblatt1` enthält folgende Spalten:

| Spalte | Überschrift | Inhalt |
|--------|-------------|--------|
| A | ID | Eindeutige ID (`mail-…` aus Flow, `temp-…`/`placetel-…` sonst) |
| B | Eingangsdatum | `yyyy-MM-dd` |
| C | Quelle | „Website" / „Telefon-Benachrichtigung" / „Manuell erfasst" |
| D | Name | |
| E | Telefon | |
| F | Email | |
| G | Anliegen/Thema | |
| H | Priorität | Sofort / Normal / Niedrig |
| I | Status | Offen / In Bearbeitung / To Do / Erledigt / Weitergeleitet |
| J | Bearbeiter | Luca / Finn / Annika / Unzugewiesen |
| K | Follow-up-Datum | |
| L | Follow-up-Zeit | |
| M | Notizen | |
| N | Änderungs-History | JSON-Array der Änderungen |
| O | Reminder-Status | Steuerfeld für Flows (z.B. „weitergeleitet-gesendet") |
| P | `__PowerAppsId__` | **Vom Google-Connector verwaltet — nicht anfassen** |
| Q | schritt | Bearbeitungs-Schritt (Etikett auf der Karte) |
| R | weitergeleitetAn | „Oliver Wrobel" / „Hanna Wrobel" |

**Wichtig:** Die Überschriften in Q1 (`schritt`) und R1 (`weitergeleitetAn`)
müssen exakt so geschrieben sein (klein/groß), damit der Power-Automate-Connector
die Felder erkennt.

---

## 5. Das Dashboard (React-App)

### Workflow-Logik
Eine Anfrage wandert von links nach rechts durch drei Spalten:

```
OFFEN  →  IN BEARBEITUNG  →  TO DO
(neu)     (aktiv dran)       (hängt, muss nochmal angefasst werden)

   → ERLEDIGT (verschwindet, nur als Tageszähler)
   → WEITERGELEITET (verschwindet, geht per Mail an Oliver/Hanna)
```

**Grundregel für die Rezeption:** Kann ich gerade etwas tun? → In Bearbeitung.
Muss ich auf jemanden/etwas warten? → To Do.

### Bearbeitungs-Schritte (Etikett auf der Karte)

**In Bearbeitung (aktiv):**
- Rückruf vereinbart
- Prüfe Terminverfügbarkeit
- Termin wird abgestimmt

**To Do (hängt):**
- Angerufen – niemand erreicht
- Wartet auf Rezept/Unterlagen
- Wartet auf Rückmeldung Patient
- In Medifox storniert
- Ausfallrechnung schreiben

Schritt und Spalte sind unabhängig — die Wahl eines Schritts verschiebt die
Karte nicht automatisch.

**Stornierungs-Ablauf:** Patient storniert → „In Medifox storniert" (Schritt) →
bei >24h direkt „Erledigt"; bei kurzfristig (<24h) erst „Ausfallrechnung
schreiben", dann „Erledigt".

### Funktionen
- **Karten** zeigen: Name, Priorität, Anliegen, Telefon, Eingangszeit,
  Schritt-Etikett, Notiz-Vorschau, Bearbeiter, Follow-up
- **Workflow-Buttons** direkt auf der Karte (ein Klick = eine Spalte weiter)
- **Detail-Modal** zum Bearbeiten aller Felder + Änderungs-History
- **Neue Anfrage** manuell anlegen (mit Duplikat-Erkennung + Merge)
- **Weiterleiten** an Oliver/Hanna (Karte verschwindet, Flow verschickt Mail)
- **Übergabe-Notizen** — freie Notizen für die nächste Schicht (eigenes Sheet)
- **Rollen:** Oliver & Hanna sind Read-Only; Rezeption bearbeitet
- **Auto-Refresh** alle 60 Sekunden
- **Zähler oben:** „X erledigt" und „X weitergeleitet" (heute)

### Design
PhysioPro-Look: Salbeigrün `#55725e`, warme Beigetöne, DM Sans +
Cormorant Garamond. Spalten als Boxen mit farbigem Kopf
(Offen=grün, In Bearbeitung=beige, To Do=bernstein).

---

## 6. Netlify Functions (Backend)

### sheets-api.js
- GET: liest alle Anfragen aus `Tabellenblatt1!A2:R1000`
- POST: schreibt das komplette Anfrage-Set zurück
- Ermittelt den Tab-Namen dynamisch (robust gegen „Tabellenblatt1" vs „Sheet1")
- Reicht die `__PowerAppsId__` (Spalte P) transparent durch, damit der
  Power-Automate-Connector seine Zeilen-Zuordnung behält
- Migriert alte Status automatisch: „Neu"→„Offen", „Angeboten"→„In Bearbeitung"

### notes-api.js
- Eigenes Sheet für die Übergabe-Notizen
- Ermittelt den Tab-Namen ebenfalls dynamisch

### Environment-Variablen (Netlify)
- `GOOGLE_SHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT` (vollständige Service-Account-JSON)
- `NODE_ENV` ist **bewusst NICHT gesetzt** — sonst werden devDependencies
  (inkl. vite) nicht installiert und der Build bricht.

---

## 7. Power Automate Flows

### Flow #1 — E-Mail → Google Sheet (LIVE)
**Trigger:** Neue Mail im freigegebenen Postfach `info@physioproluebeck.de`
**Logik:**
1. Absender-Filter: enthält „placetel" ODER „netlify" (case-insensitive
   via `toLower`)
2. Body normalisieren (BodyText-Compose): HTML-`<br>`-Tags → `|`,
   Zeilenumbrüche → `|`, HTML-Tags entfernt
3. Felder per Compose-Aktionen extrahieren (Name, Telefon, Email, Anliegen,
   Priorität, Rückruf-Hinweis)
4. Zeile ins Sheet schreiben mit Status „Offen", Bearbeiter „Unzugewiesen"

**Wichtige Einstellungen:**
- Parallelität = 1 (verhindert Google-Rate-Limit 429)
- Wiederholungsrichtlinie der Schreibaktion: Festes Intervall, 3 Versuche, PT30S

### Weiterleitungs-Flow (LIVE)
**Trigger:** Wiederkehrung alle 5 Minuten, Parallelität = 1
**Logik:**
1. Alle Zeilen aus dem Sheet abrufen
2. Pro Zeile prüfen: Status = „Weitergeleitet" UND Reminder-Status leer
3. Empfänger ableiten: Spalte R „Hanna Wrobel" → hanna.wrobel@…, sonst oliver.wrobel@…
4. Mail mit allen Anfragedaten senden (HTML-Body)
5. Reminder-Status = „weitergeleitet-gesendet" setzen (Doppelversand-Schutz)

**Empfänger-Adressen:**
- Oliver → `oliver.wrobel@pilatescompany.de`
- Hanna → `hanna.wrobel@pilatescompany.de`

**Verifiziert (19.06.2026):** Zwei Testläufe bestätigt:
- Lauf 1: 2 Mails korrekt adressiert (Oliver→oliver@, Hanna→hanna@),
  beide Zeilen auf „weitergeleitet-gesendet" gesetzt.
- Lauf 2: 0 Mails, alle Zeilen übersprungen (487 ms) → Doppelversand-Schutz
  greift sauber. Empfänger-Routing über `weitergeleitetAn` (R1-Fix) bestätigt.

### Flow #2 — Reminder (NOCH OFFEN)
Geplant: Erinnerung bei fälligem Follow-up + tägliche Zusammenfassung. Noch
nicht gebaut.

---

## 8. Gelöste Probleme & Erkenntnisse

| Problem | Ursache | Lösung |
|---------|---------|--------|
| „Verbindung fehlgeschlagen" im Dashboard | Function las fest aus `Sheet1!`, Tab heißt aber `Tabellenblatt1` | Tab-Name dynamisch ermitteln |
| Placetel-Anfragen kamen nicht durch | Filter case-sensitive; HTML-Body mit `<br>` statt Zeilenumbrüchen | `toLower` im Filter + `<br>`-Behandlung in BodyText |
| 429-Rate-Limit (Flow hängt bei „Zeile einfügen") | Mehrere gleichzeitige Schreibzugriffe | Parallelität = 1 + zahme Wiederholungsrichtlinie |
| Hanna-Weiterleitung ging an Oliver | Spalte R hatte keine Überschrift → Connector erkannte Feld nicht | R1 = `weitergeleitetAn` als Header eintragen |
| Status-Änderung im Modal wurde überschrieben | Doppel-Speichern: Button speicherte sofort, „Speichern" schrieb alten Stand zurück | Status Teil des Formulars, einmaliges Speichern |
| Uhrzeit-Feld nur manuell | HTML-`time`-Input in Webview | Dropdown in 30-Min-Schritten |
| Speichern-Button im Modal nicht sichtbar | Ganzes Modal scrollte | Kopf/Fuß fixiert, nur Body scrollt |

### Technische Merksätze
- **Power Automate „Variable initialisieren"** geht nur auf oberster Ebene,
  nicht im Bedingungs-Zweig → stattdessen „Verfassen"/Compose verwenden.
- **`__PowerAppsId__` (Spalte P)** wird vom Google-Connector automatisch
  angelegt und ist der Zeilen-Schlüssel für „Zeile aktualisieren". Nicht löschen.
- **Sheet-Header für neue Spalten** müssen gesetzt sein, sonst erkennt der
  Connector die Spalte nicht.
- **Resubmit in Power Automate** kann hängen (alte Trigger-Daten) — für Tests
  lieber frische Anfragen oder „Manuell ausführen".

---

## 9. Aktueller Stand

### Fertig & live
- ✅ Dashboard (Vollbild-Webanwendung) mit komplettem Workflow
- ✅ Flow #1 (E-Mail → Sheet) — Website + Placetel
- ✅ Weiterleitungs-Flow (Oliver/Hanna getrennt, Doppelversand-Schutz)
- ✅ Übergabe-Notizen
- ✅ Bearbeitungs-Schritte inkl. Stornierungs-Ablauf
- ✅ Rollen (Read-Only für Oliver/Hanna)

### Offen
- ⏳ **Flow #2 (Reminder):** Erinnerung bei fälligem Follow-up + Tagesübersicht
- ⏳ **Placetel-Bestand** vom 19.06. (Anfragen vor dem HTML-Fix) ggf. nachtragen
- ⏳ **Sicherheit:** GitHub-Token + Service-Account-Key rotieren (sind durch
  Chats gelaufen)

---

## 10. Wichtige Arbeitsweisen

- **Deploy** nur auf explizites „push"-Kommando; visuelle Prüfung (Mockup) vor
  Umsetzung
- **Power-Automate-Änderungen** macht der Dienstleister; Google-Logins/OAuth
  und Dashboard-Aktionen macht Oliver selbst (kein Zugriff für Externe)
- **Bei 429:** pausieren, nicht dagegen klicken — das Limit erholt sich nach
  einigen Minuten Ruhe
- **Sheet-Änderungen** an der Live-Datenbank nur nach Rückfrage

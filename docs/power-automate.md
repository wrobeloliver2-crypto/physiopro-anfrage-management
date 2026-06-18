# Power Automate Workflows

Drei Cloud-Flows verbinden das eingehende E-Mail-Postfach und die Reminder-Logik
mit dem Google Sheet ueber die Netlify Function bzw. die Google Sheets REST API.

> Hinweis: Authentifizierung gegen Google erfolgt mit dem Service-Account-Bearer-Token.
> Alternativ kann jeder Flow auch die Netlify Function (`/.netlify/functions/sheets-api`)
> als Endpunkt nutzen, statt direkt gegen die Google API zu gehen.

---

## Flow #1: E-Mail -> Google Sheet

**Trigger:** When a new email arrives (Inbox), To: info@physioproluebeck.de

**Actions:**

1. **Parse / Erkennung**
   - Pruefen, ob Webformular oder Telefon-Benachrichtigung.
   - Felder extrahieren: firstname, phone, email, message.

2. **Intelligente Zeitextraktion** (aus dem Nachrichtentext)
   - Regex: `(?:zwischen |um |:)(\d{1,2})(?::|\s|-)\d{2}`
   - Beispiele:
     - "16-18 Uhr" -> "16:00"
     - "zwischen 14:30 und 15:00" -> "14:30"
     - "14 Uhr" -> "14:00"
     - keine Zeit -> leer

3. **HTTP POST (anhaengen)**
   - URI: `https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/Sheet1:append`
   - Header: `Content-Type: application/json`, `Authorization: Bearer <Token>`
   - Body: `{ "values": [[ID, Datum, Quelle, Name, Tel, Email, Anliegen, Prioritaet, Status, Bearbeiter, FupDatum, FupZeit, Notizen, History, ReminderStatus]] }`

4. **Bestaetigungs-E-Mail**
   - To: info@physioproluebeck.de
   - Subject: "Neue Anfrage: {Name}"

**Error-Handling:** API-Fehler -> Log + Admin-Alert. Duplikate werden im Frontend behandelt.

---

## Flow #2: Reminder-Versand (taeglich 00:01)

**Trigger:** Scheduled Cloud Flow, taeglich 00:01, Zeitzone Europe/Berlin.

**Actions:**

1. **HTTP GET** des kompletten Sheets.
2. **Parse** der Antwort in ein Array von Anfragen.
3. **For Each** Anfrage:
   - Bedingung pruefen:
     - followupDatum == today
     - UND followupZeit <= now
     - UND reminderStatus == "" (leer)
     - UND status != "Erledigt"
   - Wenn erfuellt -> weiter, sonst naechste Iteration.
4. **Arbeitszeiten-Check:**
   - Mo-Fr UND 08:00-18:00 -> Reminder jetzt senden.
   - sonst: followupDatum = naechster Arbeitstag, followupZeit = 09:00, dann verschieben.
5. **E-Mail (Reminder)**
   - To: info@physioproluebeck.de
   - Subject: "RUECKRUF FAELLIG: {Name} [{Prioritaet}]"
   - Body: Kontakt-Details + Dashboard-Link.
6. **HTTP PUT** -> reminderStatus = "Gesendet".

**Frequenz:** taeglich (auch Wochenende), mit Arbeitszeiten-Anpassung.

---

## Flow #3: Taegliche Summary (taeglich 08:00)

**Trigger:** Scheduled Cloud Flow, taeglich 08:00, Zeitzone Europe/Berlin.

**Actions:**

1. **HTTP GET** des Sheets (wie Flow #2).
2. **Filter:** Status == "Neu" ODER Prioritaet == "Sofort", eingangsdatum >= gestern.
3. **HTML-E-Mail bauen** mit Tabelle (Name, Telefon, Anliegen, Prioritaet) und Statistik
   (Anzahl je Status) plus Dashboard-Link.
4. **E-Mail senden**
   - To: hanna.wrobel@physioproluebeck.de; oliver@physioproluebeck.de
   - Subject: "Taegliche Anfrage-Summary {Datum}"

**Frequenz:** taeglich (auch Wochenende).

---

## Sicherheitshinweis

Der Service-Account-Bearer-Token bzw. die Anmeldedaten gehoeren **nicht** ins Repository.
In Power Automate werden Verbindungen/Secrets ueber die geschuetzten Connection-/
Environment-Variablen verwaltet.

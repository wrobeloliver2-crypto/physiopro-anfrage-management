# Power Automate – Flow 1: E-Mail → Google Sheet

**Zweck:** Liest neue Anfrage-Mails aus `info@physioproluebeck.de`, zerlegt sie
und schreibt sie als neue Zeile ins Anfrage-Sheet. Das ist der Zubringer, der
das Dashboard mit echten Daten füllt.

**Sheet:** `18IjuUk_wq7k9MZFLiT4KvfbLVgRw-uGbDnhgLJvkGnw`
**Tab:** `Tabellenblatt1`
**Spalten (A–O):** ID, Eingangsdatum, Quelle, Name, Telefon, Email,
Anliegen/Thema, Priorität, Status, Bearbeiter, Follow-up-Datum,
Follow-up-Zeit, Notizen, Änderungs-History, Reminder-Status

---

## Die zwei echten Mail-Formate

### Format A – Telefon-KI (`no-reply@aipro.placetel.de`)
Betreff verrät den Typ, z.B. `Rückrufbitte: Frau Keller – Physiotherapie`
Body:
```
Name: Frau Keller
Tel.: 0 1 7 9 5 6 9 7 6 3 9
Anliegen: Physiotherapie
Bevorzugter Rückruf: vormittags
Caller ID/Zeitzone: +491795697639 / Zeitzone laut System UTC+2
Notizen: keine weiteren Angaben
```

### Format B – Webformular (`formresponses@netlify.com`)
Betreff immer: `Neue Anfrage - PhysioPro Website`
Body:
```
Firstname:
Leevke Bonkowsky

Phone:
0176 73526970

Email:
017673526970@rueckruf.physioproluebeck.de

Message:
Thema: Termin vereinbaren | Rückruf | Priorität: Sofort – so schnell wie möglich
```

---

## Flow-Aufbau (Schritt für Schritt)

### Schritt 1 – Trigger
- Connector: **Office 365 Outlook**
- Aktion: **„Bei Eingang einer neuen E-Mail (V3)"**
- Parameter:
  - **Ordner:** Posteingang
  - **Zu (zutreffend auf):** *(leer lassen)*
  - **Erweiterte Optionen → Von:** *(leer — wir filtern später selbst)*
  - **Postfach:** `info@physioproluebeck.de`
    (Shared Mailbox; der Flow-Besitzer braucht „Senden als/Vollzugriff")

> Hinweis: Falls nur deine eigenen Mails getriggert werden, stattdessen den
> Trigger **„… in einem freigegebenen Postfach (V2)"** nehmen und dort
> `info@physioproluebeck.de` als Postfachadresse eintragen.

### Schritt 2 – Nur relevante Absender durchlassen
- Aktion: **Bedingung** („Condition")
- Logik (ODER-Gruppe):
  - `Von` enthält `aipro.placetel.de`  **ODER**
  - `Von` enthält `formresponses@netlify.com`
- Wenn **Nein** → Flow beenden (Terminate, Status: Succeeded)
- Wenn **Ja** → weiter

### Schritt 3 – Body als reinen Text bereitstellen
- Aktion: **Variable initialisieren**
  - Name: `BodyText`
  - Typ: String
  - Wert (Ausdruck):
    ```
    replace(replace(triggerOutputs()?['body/body']?['content'], decodeUriComponent('%0D'), ''), decodeUriComponent('%0A'), '|')
    ```
  Das macht aus Zeilenumbrüchen ein `|`, damit man stabil splitten kann.

  > Wenn du den Klartext-Body bevorzugst, kannst du auch das Feld
  > **„Textkörper-Vorschau"** des Triggers verwenden; dann entfällt das HTML.

### Schritt 4 – Quelle bestimmen
- Aktion: **Variable initialisieren**
  - Name: `Quelle`
  - Typ: String
  - Wert (Ausdruck):
    ```
    if(contains(triggerOutputs()?['body/from'], 'placetel'), 'Telefon-Benachrichtigung', 'Website')
    ```

### Schritt 5 – Felder extrahieren

Lege je eine **„Variable initialisieren"**-Aktion an. Die folgenden Ausdrücke
sind robust gegen fehlende Felder (geben sonst leer zurück).

**Name**
- Telefon-KI: Text nach `Name:` bis zum nächsten `|`
- Webformular: Zeile nach `Firstname:`

Variable `Name` (String), Ausdruck:
```
trim(if(contains(variables('BodyText'), 'Name:'),
  first(split(last(split(variables('BodyText'), 'Name:')), '|')),
  first(split(last(split(variables('BodyText'), 'Firstname:|')), '|'))))
```

**Telefon** (Leerzeichen werden entfernt, weil die KI sie teils einzeln spricht)
Variable `Telefon` (String), Ausdruck:
```
trim(replace(if(contains(variables('BodyText'), 'Tel.:'),
  first(split(last(split(variables('BodyText'), 'Tel.:')), '|')),
  first(split(last(split(variables('BodyText'), 'Phone:|')), '|'))), ' ', ''))
```

**E-Mail**
Variable `Email` (String), Ausdruck:
```
if(contains(variables('BodyText'), 'Email:|'),
  trim(first(split(last(split(variables('BodyText'), 'Email:|')), '|'))), '')
```

**Anliegen** (Telefon: nach `Anliegen:`; Web: nach `Message:`)
Variable `Anliegen` (String), Ausdruck:
```
trim(if(contains(variables('BodyText'), 'Anliegen:'),
  first(split(last(split(variables('BodyText'), 'Anliegen:')), '|')),
  replace(last(split(variables('BodyText'), 'Message:|')), '|', ' ')))
```

**Priorität** (aus dem Text ablesen, sonst „Normal")
Variable `Prioritaet` (String), Ausdruck:
```
if(contains(toLower(variables('BodyText')), 'sofort'), 'Sofort',
  if(contains(toLower(variables('BodyText')), 'keine eile'), 'Niedrig', 'Normal'))
```

**Rückruf-/Follow-up-Hinweis** (Telefon-KI: „Bevorzugter Rückruf")
Variable `FollowupHinweis` (String), Ausdruck:
```
if(contains(variables('BodyText'), 'Bevorzugter Rückruf:'),
  trim(first(split(last(split(variables('BodyText'), 'Bevorzugter Rückruf:')), '|'))), '')
```

### Schritt 6 – ID und Datum erzeugen
**ID** – Variable `NeueId` (String):
```
concat('mail-', ticks(utcNow()))
```
**Eingangsdatum** – Variable `Datum` (String):
```
formatDateTime(triggerOutputs()?['body/receivedDateTime'], 'yyyy-MM-dd')
```

### Schritt 7 – Zeile ins Google Sheet schreiben
- Connector: **Google Sheets**
- Aktion: **„Zeile einfügen"** („Insert row")
- Parameter:
  - **Datei:** PhysioPro Anfrage-Management (Database)
  - **Arbeitsblatt:** `Tabellenblatt1`
  - Spalten:
    | Spalte | Wert |
    |--------|------|
    | ID | `variables('NeueId')` |
    | Eingangsdatum | `variables('Datum')` |
    | Quelle | `variables('Quelle')` |
    | Name | `variables('Name')` |
    | Telefon | `variables('Telefon')` |
    | Email | `variables('Email')` |
    | Anliegen/Thema | `variables('Anliegen')` |
    | Priorität | `variables('Prioritaet')` |
    | Status | `Offen` |
    | Bearbeiter | `Unzugewiesen` |
    | Follow-up-Datum | *(leer)* |
    | Follow-up-Zeit | *(leer)* |
    | Notizen | `variables('FollowupHinweis')` |
    | Änderungs-History | `[]` |
    | Reminder-Status | *(leer)* |

### Schritt 8 (optional) – Bestätigung an info@
- Connector: **Office 365 Outlook → „E-Mail senden (V2)"**
- An: `info@physioproluebeck.de`
- Betreff: `Anfrage erfasst: @{variables('Name')}`
- Body: kurzer Hinweis, dass die Anfrage im Dashboard liegt.

---

## Wichtig: Google-Sheets-Connector-Verbindung

Der Google-Sheets-Connector in Power Automate meldet sich mit **einem
Google-Konto** an (OAuth) – das ist **nicht** der Service-Account, sondern am
besten das Konto, dem das Sheet gehört (`wrobeloliver2@gmail.com`) oder ein
Konto mit Bearbeiter-Rechten. Einmalig beim Anlegen der „Zeile einfügen"-Aktion
autorisieren.

> Das Dashboard selbst nutzt weiterhin den Service-Account über die
> Netlify-Function. Power Automate schreibt nur zusätzlich Zeilen rein – beide
> Wege landen im selben Sheet. Kein Konflikt, weil das Dashboard beim nächsten
> Refresh (alle 60 s) die neuen Zeilen einfach mitliest.

---

## Test

1. Flow speichern und einschalten.
2. Auf der Website das Anfrageformular absenden ODER auf die Praxis-Nummer
   anrufen und auf den AB sprechen.
3. Nach ~1 Minute: Zeile erscheint im Sheet, Status „Offen".
4. Dashboard öffnen → die Anfrage steht in der Spalte „Offen".

---

## Danach: Flow 2 & 3

- **Flow 2 (Reminder):** Prüft das Sheet auf fällige Follow-ups und schickt
  zur passenden Zeit eine Erinnerung; außerhalb Mo–Fr 08–18 Uhr auf nächsten
  Arbeitstag 08:00 verschieben; Reminder-Status setzen.
- **Flow 3 (Tagesübersicht):** Täglich 08:00 eine Zusammenfassung an Hanna +
  Oliver (neue + „Sofort"-Anfragen + Statuszählung).

Diese beiden sind weniger zeitkritisch und können nach Flow 1 folgen.

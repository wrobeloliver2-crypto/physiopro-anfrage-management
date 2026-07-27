# Power Automate – Flow 1: E-Mail → Google Sheet

**Zweck:** Liest neue Anfrage-Mails aus `info@physioproluebeck.de`, zerlegt sie
und schreibt sie als neue Zeile ins Anfrage-Sheet. Das ist der Zubringer, der
das Dashboard mit echten Daten füllt.

> **Update 27.07.2026:** Ursache dafür gefunden, dass ganz normale, frei
> getippte Patienten-Mails an `info@physioproluebeck.de` nie im Dashboard
> ankamen: Schritt 2 (unten) hat bisher **ausschließlich** Mails von
> `aipro.placetel.de` (Telefon-KI) oder `formresponses@netlify.com`
> (Website-Formular) durchgelassen — jede andere Mail wurde beim Trigger
> sofort verworfen (Terminate), ohne Karte, ohne Fehlermeldung, ohne Log.
> Verifiziert gegen die echten Sheet-Daten: Es gibt bislang ausschließlich
> die Quellen „Telefon-Benachrichtigung“, „Website“ und „SMS-Rückrufwunsch“ —
> nie eine direkt eingetippte Mail. Schritt 2, 4 und 5 unten sind deshalb um
> **Format C („Direkte E-Mail“)** erweitert: Diese Anleitung ist der Bauplan
> dafür, **im echten Flow in Power Automate noch nachzuziehen** (diese Datei
> hier ändert den Flow selbst nicht, nur die Doku/den Bauplan).

**Sheet:** `18IjuUk_wq7k9MZFLiT4KvfbLVgRw-uGbDnhgLJvkGnw`
**Tab:** `Tabellenblatt1`
**Spalten (A–O):** ID, Eingangsdatum, Quelle, Name, Telefon, Email,
Anliegen/Thema, Priorität, Status, Bearbeiter, Follow-up-Datum,
Follow-up-Zeit, Notizen, Änderungs-History, Reminder-Status

---

## Die Mail-Formate

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

### Format C – Direkte E-Mail (NEU, 27.07.2026 — jeder andere Absender, sofern kein Störtraffic)
Ein Patient schreibt frei formuliert direkt an `info@physioproluebeck.de`,
ohne Umweg über Telefon-KI oder Website-Formular. Kein festes Feldschema,
kein `Name:`/`Tel.:`-Label im Text — deshalb andere Extraktion (siehe
Schritt 5):
- **Name** → Anzeigename des Absenders
- **Email** → Absenderadresse
- **Telefon** → nur falls im Fließtext eine Nummer steht, sonst leer
- **Anliegen** → Betreff + Textkörper-Vorschau (kein Label zum Splitten)

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

### Schritt 2 – Störtraffic ausschließen (bisher: nur bekannte Absender durchlassen)

**Das war der Bug:** Die alte Logik hat auf eine ERLAUBT-Liste geprüft (nur
Format A/B durch, alles andere raus) — genau das hat echte Patienten-Mails
verschluckt. Die neue Logik dreht das um: nicht mehr einschränken auf
bekannte Absender, sondern nur noch eindeutigen Störtraffic ausschließen.
Format A und B laufen weiterhin unverändert durch, weil sie in der
Ausschlussliste gar nicht vorkommen.

- Aktion: **Bedingung** („Condition")
- Ausschlusskriterien (Von ODER Betreff enthält eins davon):
  - `Von` enthält `mailer-daemon` (Zustellfehler/Bounces)
  - `Von` enthält `postmaster`
  - `Von` enthält `noreply@` **oder** `no-reply@`, **außer** wenn es die
    Telefon-KI (`aipro.placetel.de`) selbst ist — die kommt nämlich auch von
    einer No-Reply-Adresse und muss explizit ausgenommen bleiben
  - `Von` enthält `calendar-notification` oder `invites@` (Kalendereinladungen)
  - `Von` ist exakt `info@physioproluebeck.de` selbst — **siehe Warnhinweis
    unten, das ist Pflicht**
  - `Betreff` enthält `Automatische Antwort` / `Out of Office` / `Abwesenheit`
- Wenn **Ja** (= Störtraffic) → Flow beenden (Terminate, Status: Succeeded)
- Wenn **Nein** → weiter (das ist jetzt Format A, B **oder** C)

Vorschlag für den Ausdruck (eine „Ist gleich wahr"-Bedingung mit diesem
verneinten `or(...)`-Ausdruck):
```
not(or(
  contains(toLower(triggerOutputs()?['body/from']), 'mailer-daemon'),
  contains(toLower(triggerOutputs()?['body/from']), 'postmaster'),
  and(
    or(contains(toLower(triggerOutputs()?['body/from']), 'noreply@'), contains(toLower(triggerOutputs()?['body/from']), 'no-reply@')),
    not(contains(toLower(triggerOutputs()?['body/from']), 'aipro.placetel.de'))
  ),
  contains(toLower(triggerOutputs()?['body/from']), 'calendar-notification'),
  contains(toLower(triggerOutputs()?['body/from']), 'invites@'),
  equals(toLower(triggerOutputs()?['body/from']), 'info@physioproluebeck.de'),
  contains(toLower(triggerOutputs()?['body/subject']), 'automatische antwort'),
  contains(toLower(triggerOutputs()?['body/subject']), 'out of office'),
  contains(toLower(triggerOutputs()?['body/subject']), 'abwesenheit')
))
```
→ Ergebnis `true` heißt „kein Störtraffic, weiter"; `false` heißt „Flow
beenden". (Vor dem scharfschalten am besten gegen ein paar echte Alt-Mails im
Postfach durchtesten, z. B. mit „Testen → Mit Beispieldaten von einem
ausgelösten Vorgang".)

> ⚠️ **Wichtig — Selbst-Schleife vermeiden:** Schritt 8 (unten) verschickt
> optional eine Bestätigungsmail AN `info@physioproluebeck.de` selbst. Sobald
> Format C alles außer Störtraffic durchlässt, würde diese Bestätigungsmail
> den Flow erneut auslösen → neue Karte → neue Bestätigungsmail →
> Endlosschleife. Deshalb ist der Ausschluss „Von = info@physioproluebeck.de"
> oben zwingend erforderlich, **bevor** Format C aktiv geschaltet wird. Falls
> Schritt 8 schon läuft: vorher einmal prüfen, mit welcher Absenderadresse die
> Bestätigungsmail tatsächlich ankommt (bei Shared-Mailbox-Versand sollte das
> `info@physioproluebeck.de` sein, aber das lohnt sich real zu verifizieren,
> nicht nur anzunehmen).

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

### Schritt 4 – Quelle bestimmen (erweitert um Format C)
- Aktion: **Variable initialisieren**
  - Name: `Quelle`
  - Typ: String
  - Wert (Ausdruck):
    ```
    if(contains(triggerOutputs()?['body/from'], 'placetel'), 'Telefon-Benachrichtigung',
      if(contains(triggerOutputs()?['body/from'], 'netlify.com'), 'Website',
        'E-Mail direkt'))
    ```

### Schritt 5 – Felder extrahieren

Für Format A/B unverändert (Ausdrücke wie bisher, siehe unten). Format C hat
keine Labels im Text, deshalb Fallback auf die Absenderfelder statt Textsplit.

> Hinweis: Für den Absendernamen/die Absenderadresse am besten im
> Power-Automate-Designer über die dynamischen Inhalte („From", „From Name")
> arbeiten statt den JSON-Pfad blind abzutippen — je nach Connector-Version
> liefert `body/from` mal einen reinen String, mal ein verschachteltes
> `emailAddress`-Objekt. Unten als Platzhalter `triggerOutputs()?['body/from']`
> markiert; im Flow selbst gegen die tatsächliche Ausgabe eurer Trigger-Aktion
> verifizieren (z. B. per Testlauf).

**Name**
- Telefon-KI: Text nach `Name:` bis zum nächsten `|`
- Webformular: Zeile nach `Firstname:`
- Direkte E-Mail: Anzeigename des Absenders

Variable `Name` (String), Ausdruck:
```
trim(if(contains(variables('BodyText'), 'Name:'),
  first(split(last(split(variables('BodyText'), 'Name:')), '|')),
  if(contains(variables('BodyText'), 'Firstname:|'),
    first(split(last(split(variables('BodyText'), 'Firstname:|')), '|')),
    triggerOutputs()?['body/from'])))
```

**Telefon** (Leerzeichen werden entfernt, weil die KI sie teils einzeln spricht)
Variable `Telefon` (String), Ausdruck:
```
trim(replace(if(contains(variables('BodyText'), 'Tel.:'),
  first(split(last(split(variables('BodyText'), 'Tel.:')), '|')),
  first(split(last(split(variables('BodyText'), 'Phone:|')), '|'))), ' ', ''))
```
Für Format C steht die Nummer (falls überhaupt vorhanden) irgendwo frei im
Fließtext, nicht hinter einem festen Label — dafür eignet sich Textsplit
nicht. Stattdessen zusätzliche Aktion **„Rufnummern extrahieren"**
(Text-Objekt: `variables('BodyText')`) einbauen und nur greifen lassen, wenn
Format A/B nichts liefern: erste gefundene Nummer nehmen, sonst leer lassen.

**E-Mail**
Variable `Email` (String), Ausdruck:
```
if(contains(variables('BodyText'), 'Email:|'),
  trim(first(split(last(split(variables('BodyText'), 'Email:|')), '|'))),
  triggerOutputs()?['body/from'])
```

**Anliegen** (Telefon: nach `Anliegen:`; Web: nach `Message:`; Direkt: Betreff + Vorschau)
Variable `Anliegen` (String), Ausdruck:
```
trim(if(contains(variables('BodyText'), 'Anliegen:'),
  first(split(last(split(variables('BodyText'), 'Anliegen:')), '|')),
  if(contains(variables('BodyText'), 'Message:|'),
    replace(last(split(variables('BodyText'), 'Message:|')), '|', ' '),
    concat(triggerOutputs()?['body/subject'], ' — ', triggerOutputs()?['body/bodyPreview']))))
```

**Priorität** (aus dem Text ablesen, sonst „Normal") — unverändert, funktioniert
textbasiert unabhängig vom Format
Variable `Prioritaet` (String), Ausdruck:
```
if(contains(toLower(variables('BodyText')), 'sofort'), 'Sofort',
  if(contains(toLower(variables('BodyText')), 'keine eile'), 'Niedrig', 'Normal'))
```

**Rückruf-/Follow-up-Hinweis** (Telefon-KI: „Bevorzugter Rückruf") — unverändert
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
- **Siehe Warnhinweis zur Selbst-Schleife in Schritt 2** — diese Mail geht an
  dieselbe Adresse, die der Flow überwacht.

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
5. **(NEU, für Format C)** Testweise von einer privaten Mailadresse aus
   formlos an `info@physioproluebeck.de` schreiben → nach ~1 Minute sollte
   ebenfalls eine Zeile erscheinen, mit Quelle „E-Mail direkt". Zusätzlich
   einmal bewusst eine automatische Abwesenheitsnotiz/einen Bounce simulieren
   (oder abwarten, bis einer natürlich reinkommt) und prüfen, dass dafür
   **keine** Karte entsteht.

---

## Danach: Flow 2 & 3

- **Flow 2 (Reminder):** Prüft das Sheet auf fällige Follow-ups und schickt
  zur passenden Zeit eine Erinnerung; außerhalb Mo–Fr 08–18 Uhr auf nächsten
  Arbeitstag 08:00 verschieben; Reminder-Status setzen.
- **Flow 3 (Tagesübersicht):** Täglich 08:00 eine Zusammenfassung an Hanna +
  Oliver (neue + „Sofort"-Anfragen + Statuszählung).

Diese beiden sind weniger zeitkritisch und können nach Flow 1 folgen.

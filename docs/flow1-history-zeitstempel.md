# Flow #1 — History-Zeitstempel (Spalte N "Änderungs-History")

**Status:** ✅ Live & veröffentlicht (20.06.2026)
**Flow:** PhysioPro Anfrage-Management – Flow #1 (E-Mail → Google Sheet)
**Flow-ID:** `c9d75ccd-c171-69e1-2ef3-6468d41a60ac`
**Environment:** `Default-84c5926a-a7f0-4d30-bfe6-8d445df9a2ba`
**Sheet:** `18IjuUk_wq7k9MZFLiT4KvfbLVgRw-uGbDnhgLJvkGnw`, table `0`

## Ziel
Beim Anlegen einer neuen Anfrage soll Spalte N ("Änderungs-History")
einen History-Eintrag mit echtem Eingangs-Zeitstempel erhalten, den das
Dashboard parsen kann, um die Uhrzeit auf der Karte anzuzeigen.

Reine Erweiterung — bestehende Flow-Logik wurde NICHT geändert. Gilt nur
für NEUE Anfragen ab Veröffentlichung. Kein `utcNow()`, sondern Zeitstempel
aus `receivedDateTime` als Berliner Lokalzeit MIT Offset (ISO 8601),
parsebar via JavaScript `new Date()`.

## Erwartetes Ergebnis in Spalte N
```json
[{"zeitstempel":"2026-06-20T15:03:51+02:00","aktion":"Erstellt","von":"System","details":"Eingang per Mail"}]
```
(gerade Anführungszeichen, DST-sicherer Offset: Sommer +02:00 / Winter +01:00)

## Umgesetzte Compose-Kette (im "Wahr"-Zweig der Bedingung)
Reihenfolge: … → Datum → **LokalZeit → OffsetStd → ErstelltISO → HistoryJSON** → Zeile einfügen

**LokalZeit** — Berliner Lokalzeit ohne Offset
```
convertTimeZone(triggerOutputs()?['body/receivedDateTime'],'UTC','W. Europe Standard Time','yyyy-MM-ddTHH:mm:ss')
```

**OffsetStd** — Stundendifferenz Lokal vs. UTC (DST-sicher)
```
div(sub(ticks(convertTimeZone(triggerOutputs()?['body/receivedDateTime'],'UTC','W. Europe Standard Time','yyyy-MM-ddTHH:mm:ss')),ticks(formatDateTime(triggerOutputs()?['body/receivedDateTime'],'yyyy-MM-ddTHH:mm:ss'))),36000000000)
```

**ErstelltISO** — Lokalzeit + Offset als +0X:00 anhängen
```
concat(outputs('LokalZeit'),'+',if(less(outputs('OffsetStd'),10),concat('0',string(outputs('OffsetStd'))),string(outputs('OffsetStd'))),':00')
```

**HistoryJSON** — JSON-Array mit escapten Anführungszeichen
```
concat('[{\"zeitstempel\":\"',outputs('ErstelltISO'),'\",\"aktion\":\"Erstellt\",\"von\":\"System\",\"details\":\"Eingang per Mail\"}]')
```

## Änderung in "Zeile einfügen" (item-Ausdruck)
Nur das eine Segment getauscht — alle anderen Felder unverändert:
```
…'\",\"Änderungs-History\":\"',outputs('HistoryJSON'),'\",\"Reminder-Status\":\"\"}'))
```
(vorher: `\"Änderungs-History\":\"[]\"`)

runAfter: `HistoryJSON → ["Succeeded"]`, retryPolicy: Fixed, PT30S, count 3.

## Gelöste Probleme (Lessons Learned)
- **Escaping:** Im Item-Ausdruck sind alle JSON-Quotes als `\"` gespeichert.
  HistoryJSON muss ebenfalls `\"` ausgeben, damit das äußere `json()` parst.
  Maßgeblich ist die **Codeansicht** (nicht die fx-Anzeige).
- **Offset-Bug:** `convertTimeZone` mit `zzz`-Token rendert fälschlich `+00:00`.
  Lösung: Offset dynamisch aus Ticks-Differenz berechnen (DST-sicher).
- **Google-Sheets 429 (TooManyRequests):** Tritt beim Veröffentlichen
  (GetTable-Validierung) und bei Schreibvorgängen auf. NICHT dagegen hämmern —
  ~60–90 s Cooldown abwarten, dann erneut veröffentlichen.

## Verifikation (Test 20.06.2026, 15:04 — Erfolgreich)
- (a) Zeile geschrieben: `statusCode 201` ✓
- (b) Spalte N: gültiges Array, gerade Quotes ✓
- (c) Zeitstempel: `2026-06-20T15:03:51+02:00` (echte Lokalzeit, +02:00) ✓

## Rollback-Pfad (falls je nötig)
item-Segment zurück auf `\"Änderungs-History\":\"[]\"`, die 4 Composes
(LokalZeit, OffsetStd, ErstelltISO, HistoryJSON) entfernen, neu veröffentlichen.

## Offene Aufräumarbeit (durch Oliver)
Test-Zeilen im Sheet löschen: "Uhrzeit Claude", "Uhrzeit Claude 2" (Spalte N = `[]`)
und "Uhrzeit Claude 3" (Spalte N = History-Eintrag, ID `mail-639175574929275716`).

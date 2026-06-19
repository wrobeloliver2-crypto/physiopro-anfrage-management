# Übergabe: Flow #2 (Reminder) — PhysioPro Rezeptionsdashboard

**Zweck dieser Datei:** Einstieg für einen neuen Chat, um die Reminder-Funktion
(Power Automate Flow #2) zu bauen. Das Dashboard und zwei andere Flows laufen
bereits produktiv. Hier steht nur, was für Flow #2 relevant ist.

**Stand:** 19. Juni 2026

---

## 1. Was bereits läuft (Kontext)

- **Dashboard:** Vollbild-Webanwendung, https://leadmanagementphysiopro.netlify.app
- **Flow #1 (E-Mail → Sheet):** LIVE — schreibt eingehende Anfragen ins Sheet
- **Weiterleitungs-Flow:** LIVE & verifiziert — schickt weitergeleitete Anfragen
  an Oliver/Hanna, mit Doppelversand-Schutz über Spalte O (Reminder-Status)

**Flow #2 (Reminder) ist NOCH NICHT gebaut** — das ist die Aufgabe.

---

## 2. Architektur (relevant für Flow #2)

```
GOOGLE SHEET (Datenbank)
  ID:  18IjuUk_wq7k9MZFLiT4KvfbLVgRw-uGbDnhgLJvkGnw
  Tab: Tabellenblatt1
        ▲
        │ liest / schreibt
        ▼
POWER AUTOMATE (Tenant 84c5926a, Umgebung "Physio Pro Lübeck (default)")
  Konto: oliver.wrobel@pilatescompany.de
```

Der Reminder-Flow arbeitet wie der Weiterleitungs-Flow: zeitgesteuert das Sheet
abfragen, passende Zeilen finden, Mail schicken, Steuerfeld setzen.

---

## 3. Sheet-Spalten (relevant für Reminder)

| Spalte | Überschrift | Inhalt |
|--------|-------------|--------|
| D | Name | |
| E | Telefon | E.164-Format (+49…) |
| F | Email | |
| G | Anliegen/Thema | |
| H | Priorität | Sofort / Normal / Niedrig |
| I | Status | Offen / In Bearbeitung / To Do / Erledigt / Weitergeleitet |
| J | Bearbeiter | Luca / Finn / Annika / Unzugewiesen |
| K | Follow-up-Datum | `yyyy-MM-dd` (vom Dashboard gesetzt) |
| L | Follow-up-Zeit | `HH:mm` (Dropdown 08:00–18:00, 30-Min-Schritte) |
| M | Notizen | |
| O | Reminder-Status | **Steuerfeld** — schon von Weiterleitung genutzt |
| P | `__PowerAppsId__` | Connector-Schlüssel — nicht anfassen |
| R | weitergeleitetAn | „Oliver Wrobel" / „Hanna Wrobel" |

**WICHTIG zu Spalte O (Reminder-Status):** Wird bereits vom Weiterleitungs-Flow
mit „weitergeleitet-gesendet" beschrieben. Der Reminder-Flow muss einen
EIGENEN Wert verwenden (z.B. „reminder-gesendet"), damit sich die beiden Flows
nicht in die Quere kommen. Alternativ ein anderes Feld nutzen — beim Bauen
entscheiden.

---

## 4. Was Flow #2 tun soll (bereits mit Oliver abgestimmt)

Aus den Vorgesprächen steht fest:

**WANN erinnern:** Beides —
1. **Sofort-Reminder** zum exakten Follow-up-Zeitpunkt (Datum K + Zeit L erreicht)
2. **Tägliche Zusammenfassung** morgens

**AN WEN:** Logik analog zur Weiterleitung —
- Wenn die Anfrage weitergeleitet wurde (Spalte R = Oliver/Hanna) → an die Person
- Sonst → an die Rezeption: `info@physioproluebeck.de`

**Empfänger-Adressen:**
- Rezeption → `info@physioproluebeck.de`
- Oliver → `oliver.wrobel@pilatescompany.de`
- Hanna → `hanna.wrobel@pilatescompany.de`

**Arbeitszeit-Regel (aus ursprünglicher Spec):** Reminder außerhalb Mo–Fr
08–18 Uhr auf den nächsten Arbeitstag 08:00 verschieben.

---

## 5. Offene Designfragen (mit Oliver klären, BEVOR gebaut wird)

1. **Welche Anfragen lösen einen Reminder aus?** Noch nicht final entschieden.
   Optionen: nur „To Do", oder alle mit Follow-up-Datum, oder „To Do + In
   Bearbeitung". (Im letzten Chat offengeblieben.)
2. **Doppelversand-Schutz:** Eigener Reminder-Status-Wert (z.B.
   „reminder-gesendet") — aber was, wenn ein Follow-up mehrfach erinnert werden
   soll (z.B. täglich bis erledigt)? Dann braucht es eine andere Logik als das
   einmalige Setzen.
3. **Tägliche Zusammenfassung — Inhalt:** Welche Anfragen rein? (Neue +
   „Sofort"-Anfragen + Statuszählung war die ursprüngliche Idee.) Uhrzeit
   (z.B. 08:00)? An wen (Hanna + Oliver, oder auch info@)?
4. **Sofort-Reminder Takt:** Flow läuft alle X Minuten und prüft fällige
   Follow-ups — welcher Takt (5 Min wie Weiterleitung)?

---

## 6. Technische Merksätze (aus den bisherigen Flows gelernt)

- **Parallelität = 1** im Trigger setzen (verhindert Google 429-Rate-Limit).
- **Wiederholungsrichtlinie** der Sheet-Schreibaktion: Festes Intervall,
  3 Versuche, PT30S (sonst hängt die Aktion minutenlang bei 429).
- **„Variable initialisieren"** geht nur auf oberster Flow-Ebene, nicht im
  Bedingungs-Zweig → „Verfassen"/Compose verwenden.
- **`__PowerAppsId__` (Spalte P)** ist der Zeilen-Schlüssel für „Zeile
  aktualisieren". Nicht löschen.
- **Neue Sheet-Spalten brauchen eine Überschrift in Zeile 1**, sonst erkennt
  der Connector das Feld nicht (das war der „Hanna ging an Oliver"-Bug).
- **Bei 429:** pausieren, nicht dagegen klicken — Limit erholt sich nach
  einigen Minuten Ruhe.
- **Resubmit kann hängen** (alte Trigger-Daten) — für Tests „Manuell ausführen"
  oder frische Daten.
- **Datums-/Zeitvergleich:** Follow-up-Datum (K) + Follow-up-Zeit (L) zu einem
  Zeitstempel zusammensetzen und mit `utcNow()` vergleichen. Achtung Zeitzone
  (Deutschland UTC+1/+2) — beim Bauen auf korrekte Lokalzeit achten.

---

## 7. Arbeitsteilung

- **Power-Automate-Aufbau** macht der externe Dienstleister (hat Tenant-Zugriff).
  Claude schreibt die Bauanleitung als kopierbaren Block.
- **Google-Logins/OAuth** und **Dashboard-Aktionen** macht Oliver selbst.
- **Claude** kann das Google Sheet über Tools LESEN (zur Verifikation), aber
  NICHT direkt Zellen schreiben und NICHT Power Automate bedienen.
- **Tests:** Dienstleister löst Flow-Läufe aus, Oliver erzeugt Dashboard-Daten,
  Claude verifiziert das Ergebnis im Sheet.

---

## 8. Ressourcen-Kurzliste

- **GitHub-Repo:** `wrobeloliver2-crypto/physiopro-anfrage-management` (privat)
- **Netlify-Site:** `leadmanagementphysiopro`
- **Anfrage-Sheet:** `18IjuUk_wq7k9MZFLiT4KvfbLVgRw-uGbDnhgLJvkGnw` / Tabellenblatt1
- **Service-Account:** `physiopro-anfrage@physiopro-anfrage-tool.iam.gserviceaccount.com`
- **Tenant:** `84c5926a` / Konto `oliver.wrobel@pilatescompany.de`
- **Mailbox:** `info@physioproluebeck.de` (Shared Mailbox)
- **Volldokumentation:** `docs/PROJEKTDOKUMENTATION.md` im Repo

---

## 9. Erster Schritt im neuen Chat

1. Diese Datei lesen.
2. Mit Oliver die 4 offenen Designfragen aus Abschnitt 5 klären
   (am besten per Multiple-Choice-Buttons).
3. Dann die Bauanleitung für Flow #2 schreiben (kopierbarer Block für den
   Dienstleister), Reihenfolge: erst Sofort-Reminder, dann Tagesübersicht.
4. Testen: Oliver setzt im Dashboard ein Follow-up mit Datum/Zeit in der
   Vergangenheit → Dienstleister löst Flow manuell aus → Claude prüft im Sheet,
   ob der Reminder-Status gesetzt wurde und ob die Mail an den richtigen
   Empfänger ging.

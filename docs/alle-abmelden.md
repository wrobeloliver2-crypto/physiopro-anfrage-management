# Alle Nutzer abmelden (neue Anmeldung erzwingen)

Dashboard-Sitzungen sind signierte Tokens (`netlify/lib/auth.cjs`, 12 Std. gültig,
im `sessionStorage` des Tabs). Signiert wird mit der Netlify-Variable
`DASHBOARD_TOKEN_SECRET`. Wird der Schlüssel ausgetauscht, sind alle bestehenden
Tokens sofort ungültig: Die nächste Anfrage bekommt 401, das Dashboard zeigt die
Anmeldung (Name antippen + PIN). Daten gehen dabei nicht verloren.

## Ablauf

1. Neuen Zufallswert erzeugen, z. B. `openssl rand -base64 48`.
2. Netlify, Site `leadmanagementphysiopro` → Environment variables →
   `DASHBOARD_TOKEN_SECRET` → nur den Kontext **production** ersetzen
   (Branch-/Preview-Kontexte haben einen eigenen Wert und bleiben unverändert),
   als Secret markiert, Scope `functions`.
3. Neuen Produktions-Deploy auslösen (Variablen wirken erst nach einem Deploy).
4. Prüfen: Dashboard neu laden → Anmeldebildschirm erscheint.

## Verlauf

- 07.10.2026, ca. 11:05: Schlüssel rotiert (Wunsch Oliver: nach Umstellung auf
  PIN-Login alle neu anmelden lassen). Deploy über diesen Commit.

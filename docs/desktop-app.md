# PhysioPro Rezeptionsdashboard — Desktop-App (macOS)

Die Desktop-App ist eine [Tauri](https://tauri.app)-Anwendung. Sie verwendet
dasselbe React-Frontend wie die Web-Version, läuft aber als eigenständiges,
randloses Fenster, das **immer im Vordergrund** schwebt — auch über dem Browser.

## Was die App tut

- Schwebendes Always-on-Top-Fenster (per Pin-Icon oben rechts umschaltbar)
- Rezeptionsdashboard mit drei Spalten: **Offen → In Bearbeitung → To Do**
- Eigener Bereich für **Übergabe-Notizen** (Schichtübergabe)
- „Erledigt heute" als Zähler (erledigte Einträge verschwinden aus dem Board)
- Auto-Refresh alle 60 Sekunden
- Daten kommen über die Netlify-Functions (`sheets-api`, `notes-api`) —
  der Google-Service-Key bleibt serverseitig, nie in der App.

## Voraussetzungen (einmalig auf dem Mac)

1. **Node.js** (≥ 18): https://nodejs.org
2. **Rust** (für den Tauri-Build):
   ```
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
3. **Xcode Command Line Tools**:
   ```
   xcode-select --install
   ```

## App lokal starten (Entwicklung)

```
npm install
npm run app:dev
```

Das öffnet die App in einem Fenster mit Live-Reload.

## App bauen (fertige .app / .dmg)

```
npm install
npm run app:build
```

Ergebnis liegt danach unter:
```
src-tauri/target/release/bundle/macos/PhysioPro Rezeption.app
src-tauri/target/release/bundle/dmg/PhysioPro Rezeption_1.0.0_*.dmg
```

Die `.app` einfach in den Programme-Ordner ziehen. Die `.dmg` ist zum
Weitergeben / Installieren auf dem Rezeptions-Mac gedacht.

## Icons neu generieren (optional)

Falls das Icon geändert werden soll, ein 1024×1024-PNG ablegen und:
```
npm run tauri icon pfad/zum/icon.png
```
Das erzeugt automatisch alle benötigten Formate (.icns, .ico, PNGs).

## Backend-URL

Die App spricht standardmäßig `https://leadmanagementphysiopro.netlify.app` an.
Soll eine andere URL verwendet werden, in einer `.env` setzen:
```
VITE_BACKEND_BASE=https://andere-url.netlify.app
```

## Code-Signing (für Verteilung ohne Sicherheitswarnung)

Ohne Apple-Developer-Zertifikat zeigt macOS beim ersten Start eine Warnung
(„Programm aus nicht verifizierter Quelle"). Per Rechtsklick → Öffnen lässt
sich das umgehen. Für eine saubere Verteilung wäre ein Apple-Developer-Account
nötig (Signing + Notarization) — das ist optional und kein Blocker für den
internen Einsatz an der Rezeption.

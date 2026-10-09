// ====================================================================
// Regeln für interne Nachrichten (reine Funktionen, ohne Abhängigkeiten)
// --------------------------------------------------------------------
// Frontend nutzt diese Datei direkt. Das Backend nutzt die identische Kopie
// netlify/lib/nachricht-regeln.cjs (der Test tests/nachrichtRegeln.test.mjs
// prüft, dass beide Dateien denselben Funktionscode enthalten).
// Beim Ändern IMMER beide Dateien anpassen.
//
// Schließen-Regel:
//  - Der Absender (nachricht.von.id) darf immer schließen.
//  - Jede andere Person darf schließen, solange sie nicht den LETZTEN
//    Verlaufseintrag geschrieben hat. Wer zuletzt geantwortet hat (und nicht
//    Absender ist), muss auf den Absender warten.
// ====================================================================
//-- REGELN-START
function darfNachrichtSchliessen(nachricht, meId) {
  const ich = String(meId == null ? '' : meId);
  const von = nachricht && typeof nachricht === 'object' ? nachricht.von : null;
  if (!ich || !von || von.id == null || String(von.id) === '') {
    return { erlaubt: false, grund: 'Nachricht oder Anmeldung unvollständig', wartetAuf: null };
  }
  if (String(von.id) === ich) return { erlaubt: true, grund: '', wartetAuf: null };
  const verlauf = Array.isArray(nachricht.verlauf) ? nachricht.verlauf : [];
  const letzter = verlauf.length ? verlauf[verlauf.length - 1] : null;
  if (letzter && String(letzter.autorId == null ? '' : letzter.autorId) === ich) {
    const name = von.name || 'dem Absender';
    return {
      erlaubt: false,
      grund: 'Du hast zuletzt geantwortet – die Nachricht wartet auf ' + name,
      wartetAuf: von.name || null,
    };
  }
  return { erlaubt: true, grund: '', wartetAuf: null };
}

// Hat jemand anderes als der Absender die Nachricht geschlossen und der
// Absender hat das noch nicht quittiert? Dann { von:{id,name}, zeit }, sonst null.
function schliessenHinweisFuerAbsender(nachricht, meId) {
  const ich = String(meId == null ? '' : meId);
  if (!ich || !nachricht || typeof nachricht !== 'object' || !nachricht.von) return null;
  if (String(nachricht.von.id) !== ich) return null;
  const g = nachricht.geschlossen;
  if (!g || typeof g !== 'object' || !g.von) return null;
  if (String(g.von.id) === ich) return null;
  const q = nachricht.quittiert && typeof nachricht.quittiert === 'object' ? nachricht.quittiert : {};
  if (q[ich]) return null;
  return { von: { id: String(g.von.id), name: g.von.name || '—' }, zeit: g.zeit || '' };
}
//-- REGELN-ENDE

export { darfNachrichtSchliessen, schliessenHinweisFuerAbsender };

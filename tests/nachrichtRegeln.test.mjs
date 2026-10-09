import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { darfNachrichtSchliessen, schliessenHinweisFuerAbsender } from '../src/nachrichtRegeln.js';

const require = createRequire(import.meta.url);
const be = require('../netlify/lib/nachricht-regeln.cjs');

const msg = (verlauf, extra = {}) => ({
  von: { id: '1', name: 'Oliver' },
  an: { typ: 'person', id: '2', name: 'Annika' },
  verlauf,
  gelesen: {},
  ...extra,
});
const e = (autorId, autor) => ({ zeit: '2026-10-09T10:00:00Z', autorId, autor, text: 'x' });

for (const [label, fn] of [['Frontend', darfNachrichtSchliessen], ['Backend', be.darfNachrichtSchliessen]]) {
  test(label + ': Absender darf immer schließen (auch als letzter Autor)', () => {
    assert.equal(fn(msg([e('1', 'Oliver')]), '1').erlaubt, true);
    assert.equal(fn(msg([e('1', 'Oliver'), e('2', 'Annika'), e('1', 'Oliver')]), '1').erlaubt, true);
    assert.equal(fn(msg([e('1', 'Oliver'), e('2', 'Annika')]), '1').erlaubt, true);
  });
  test(label + ': Empfänger ohne eigene Antwort darf schließen', () => {
    assert.equal(fn(msg([e('1', 'Oliver')]), '2').erlaubt, true);
  });
  test(label + ': Empfänger, der zuletzt geantwortet hat, ist gesperrt', () => {
    const r = fn(msg([e('1', 'Oliver'), e('2', 'Annika')]), '2');
    assert.equal(r.erlaubt, false);
    assert.equal(r.wartetAuf, 'Oliver');
    assert.equal(r.grund, 'Du hast zuletzt geantwortet – die Nachricht wartet auf Oliver');
  });
  test(label + ': Absender hat zuletzt geschrieben -> Empfänger darf, auch nach früherer Antwort', () => {
    assert.equal(fn(msg([e('1', 'Oliver'), e('2', 'Annika'), e('1', 'Oliver')]), '2').erlaubt, true);
  });
  test(label + ': Standort-Nachricht', () => {
    const m = msg([e('1', 'Oliver')], { an: { typ: 'standort', standort: 'stockelsdorf', name: 'Stockelsdorf' } });
    assert.equal(fn(m, '7').erlaubt, true); // beliebige Person am Standort
    const m2 = msg([e('1', 'Oliver'), e('7', 'Sven')], { an: m.an });
    assert.equal(fn(m2, '7').erlaubt, false); // Sven hat zuletzt geantwortet
    assert.equal(fn(m2, '8').erlaubt, true); // Kollegin kann schließen
    assert.equal(fn(m2, '1').erlaubt, true);
  });
  test(label + ': fehlende Daten -> nicht erlaubt, kein Fehler', () => {
    for (const [n, id] of [[null, '1'], [undefined, '1'], [{}, '1'], [msg([]), ''], [msg([]), null], [{ von: {} }, '1']]) {
      const r = fn(n, id);
      assert.equal(r.erlaubt, false);
      assert.ok(r.grund);
    }
  });
  test(label + ': leerer Verlauf / fehlender Verlauf -> Nicht-Absender darf', () => {
    assert.equal(fn(msg([]), '2').erlaubt, true);
    const m = msg([]); delete m.verlauf;
    assert.equal(fn(m, '2').erlaubt, true);
  });
  test(label + ': ids als Zahl und Text werden gleich behandelt', () => {
    assert.equal(fn({ von: { id: 1, name: 'O' }, verlauf: [{ autorId: 2 }] }, 2).erlaubt, false);
    assert.equal(fn({ von: { id: 1, name: 'O' }, verlauf: [{ autorId: 2 }] }, 1).erlaubt, true);
  });
}

for (const [label, fn] of [['Frontend', schliessenHinweisFuerAbsender], ['Backend', be.schliessenHinweisFuerAbsender]]) {
  const zu = { von: { id: '2', name: 'Annika' }, zeit: 'T' };
  test(label + ': Hinweis für Absender, wenn Empfänger geschlossen hat', () => {
    const h = fn(msg([e('1', 'Oliver')], { geschlossen: zu, quittiert: {} }), '1');
    assert.deepEqual(h, { von: { id: '2', name: 'Annika' }, zeit: 'T' });
  });
  test(label + ': kein Hinweis nach Quittierung, bei Selbstschluss, für Dritte, ohne Schließung', () => {
    assert.equal(fn(msg([], { geschlossen: zu, quittiert: { 1: 'Z' } }), '1'), null);
    assert.equal(fn(msg([], { geschlossen: { von: { id: '1', name: 'Oliver' }, zeit: 'T' } }), '1'), null);
    assert.equal(fn(msg([], { geschlossen: zu }), '2'), null);
    assert.equal(fn(msg([]), '1'), null);
    assert.equal(fn(null, '1'), null);
  });
  test(label + ': fehlendes quittiert zählt als nicht quittiert', () => {
    assert.ok(fn(msg([], { geschlossen: zu }), '1'));
  });
}

test('Frontend- und Backend-Regeln enthalten denselben Funktionscode', () => {
  const norm = (s) => s.slice(s.indexOf('//-- REGELN-START'), s.indexOf('//-- REGELN-ENDE'));
  const fe = readFileSync(new URL('../src/nachrichtRegeln.js', import.meta.url), 'utf8');
  const cj = readFileSync(new URL('../netlify/lib/nachricht-regeln.cjs', import.meta.url), 'utf8');
  assert.equal(norm(fe), norm(cj));
});

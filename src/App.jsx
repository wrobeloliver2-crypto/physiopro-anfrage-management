import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, Phone, Mail, Clock, AlertTriangle, ChevronDown, ChevronUp,
  X, Trash2, Calendar, User, Globe, Check, RefreshCw, StickyNote,
  PhoneCall, Pin, ArrowRight, ArrowLeft, Send, Inbox, UserCheck,
  Search, FileText, PhoneOff, CalendarCheck, Hourglass, RotateCcw,
  CheckCircle2, Frown, CalendarX, Megaphone, Archive,
} from 'lucide-react';

// ====================================================================
// Konfiguration
// ====================================================================
// BACKEND_BASE leer = relativ zur eigenen Domain. Damit nutzt der develop-Deploy
// automatisch seine eigene Function (Test-Sheet), der main-Deploy seine (Live-Sheet).
// Nur als Override (z.B. lokale Entwicklung) kann VITE_BACKEND_BASE gesetzt werden.
const BACKEND_BASE = import.meta.env.VITE_BACKEND_BASE || '';
const API_URL = BACKEND_BASE + '/.netlify/functions/sheets-api';
const NOTES_URL = BACKEND_BASE + '/.netlify/functions/notes-api';

const SPALTEN = ['Offen', 'In Bearbeitung', 'To Do'];
const ALLE_STATUS = ['Offen', 'In Bearbeitung', 'To Do', 'Erledigt', 'Weitergeleitet'];
const PRIORITAETEN = ['Sofort', 'Normal', 'Niedrig'];
const BEARBEITER = ['Luca', 'Finn', 'Annika', 'Unzugewiesen'];
const QUELLEN = ['Website', 'Telefon-Benachrichtigung', 'Manuell erfasst'];
const READ_ONLY_USERS = ['Oliver Wrobel', 'Hanna Wrobel'];
const ALLE_USER = ['Luca', 'Finn', 'Annika', 'Oliver Wrobel', 'Hanna Wrobel'];

// Bearbeitungs-Schritte, getrennt nach aktiv (In Bearbeitung) / haengt (To Do)
const SCHRITTE_AKTIV = ['Rückruf vereinbart', 'Prüfe Terminverfügbarkeit', 'Termin wird abgestimmt'];
const SCHRITTE_HAENGT = ['Angerufen – niemand erreicht', 'Wartet auf Rezept/Unterlagen', 'Wartet auf Rückmeldung Patient', 'In Medifox storniert', 'Ausfallrechnung schreiben', 'Bestätigung senden'];

// Schritt rund um die Terminbestätigung (Outlook-Entwurf). Hält die Karte sichtbar
// in To Do, bis die Rezeption die Bestätigung tatsächlich versendet hat.
const SCHRITT_BESTAETIGUNG = 'Bestätigung senden';
const BESTAETIGUNG_SCHRITTE = [SCHRITT_BESTAETIGUNG];

// Ergebnis-Optionen (Pflicht beim Abschließen). Gruppiert für das Erledigt-Popup.
const ERGEBNIS_GRUPPEN = [
  { titel: 'Termin vereinbart', primaer: true, optionen: [
    'Termin vereinbart – Physiotherapie',
    'Termin vereinbart – Osteopathie / Julia',
    'Termin vereinbart – Physiocoaching / Hanna',
  ]},
  { titel: 'Terminabsage', optionen: [
    'Terminabsage – rechtzeitig (>24h)',
    'Terminabsage – kurzfristig (<24h, mit Ausfallrechnung)',
    'Terminabsage – kurzfristig (<24h, ohne Ausfallrechnung)',
  ]},
  { titel: 'Kein Ergebnis – Patient', optionen: [
    'Nicht erreichbar – kein Termin',
    'Kein Interesse / zurückgezogen',
    'Rezept fehlt – Patient meldet sich nicht',
    'Patient nicht versorgungsfähig',
  ]},
  { titel: 'Kein Ergebnis – Praxis', optionen: [
    'Kein freier Termin – Warteliste angeboten',
    'Außerhalb Versorgungsbereich',
    'Weiterverwiesen an andere Praxis',
  ]},
  { titel: 'Sonstiges', optionen: [
    'Doppelte Anfrage / bereits erfasst',
    'Testanfrage / intern',
  ]},
];
const ALLE_ERGEBNISSE = ERGEBNIS_GRUPPEN.flatMap((g) => g.optionen);
const istTerminErgebnis = (e) => typeof e === 'string' && e.startsWith('Termin vereinbart');
const istAbsage = (e) => typeof e === 'string' && e.startsWith('Terminabsage');
// Diese Absage-Option schließt NICHT ab, sondern erzwingt erst "Ausfallrechnung schreiben" (To Do).
const ERGEBNIS_AUSFALLRECHNUNG = 'Terminabsage – kurzfristig (<24h, mit Ausfallrechnung)';

// Uhrzeit-Slots 08:00–18:00 in 30-Min-Schritten
const ZEIT_SLOTS = (() => {
  const s = [];
  for (let h = 8; h <= 18; h++) { s.push(String(h).padStart(2,'0')+':00'); if (h<18) s.push(String(h).padStart(2,'0')+':30'); }
  return s;
})();

const SPALTEN_META = {
  'Offen':          { farbe: '#55725e', box: '#f4f7f5', rand: '#dde8e0', icon: Inbox },
  'In Bearbeitung': { farbe: '#8c7660', box: '#faf7f2', rand: '#ece1d2', icon: UserCheck },
  'To Do':          { farbe: '#b8742a', box: '#fbf5ec', rand: '#f0e2cb', icon: AlertTriangle },
};
const PRIO_STYLE = {
  Sofort: { rand: '#c0392b', text: '#c0392b', bg: '#fbeae8' },
  Normal: { rand: '#55725e', text: '#3d5445', bg: '#eef3f0' },
  Niedrig:{ rand: '#c4b09a', text: '#8c7660', bg: '#f7f0e8' },
};

// ====================================================================
// Hilfsfunktionen
// ====================================================================
const heute = () => new Date().toISOString().slice(0,10);
const jetztISO = () => new Date().toISOString();
const neueId = () => 'temp-' + Date.now();
const uhrzeit = (iso) => { try { return new Date(iso).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}); } catch { return ''; } };

function eingangLabel(a) {
  if (!a.eingangsdatum) return '';
  const d = a.eingangsdatum;
  const heuteStr = heute();
  const gestern = new Date(Date.now()-86400000).toISOString().slice(0,10);
  if (d === heuteStr) return 'Heute';
  if (d === gestern) return 'Gestern';
  const [y,m,t] = d.split('-');
  return t + '.' + m + '.';
}
function historyEintrag(aktion, von, details) { return { zeitstempel: jetztISO(), aktion, von, details }; }
// Eingangs-Uhrzeit: aus dem "Erstellt"-History-Eintrag ableiten (voller Zeitstempel).
// Faellt sauber leer aus, wenn keine History/kein Zeitstempel vorhanden ist (Altdaten).
// Voller Eingangs-Zeitstempel (Date) der Karte. Robust gegen beide History-
// Schemata: Frontend schreibt {aktion:'Erstellt', details}, Flow #1 schreibt
// {feld:'Erstellt', wert}. Fallback: erster History-Eintrag mit Zeitstempel.
function eingangsTS(a) {
  const hist = a.history || [];
  const erstellt = hist.find((e) => e && (e.aktion === 'Erstellt' || e.feld === 'Erstellt') && e.zeitstempel);
  const eintrag = erstellt || hist.find((e) => e && e.zeitstempel);
  if (!eintrag) return null;
  const d = new Date(eintrag.zeitstempel);
  return isNaN(d.getTime()) ? null : d;
}
function eingangsZeit(a) {
  const d = eingangsTS(a);
  return d ? uhrzeit(d.toISOString()) : '';
}
// Frist-Ampel auf der Karte (60-Minuten-Ziel ab Eingang):
//   'gruen' = heute reingekommen, < 60 Min her
//   'rot'   = heute reingekommen, >= 60 Min her
//   null    = kein Eingangs-Zeitstempel (Altdaten) oder nicht von heute -> kein Punkt
function fristStatus(a) {
  if (a.eingangsdatum !== heute()) return null;
  const d = eingangsTS(a);
  if (!d) return null;
  return (Date.now() - d.getTime()) >= 60 * 60 * 1000 ? 'rot' : 'gruen';
}
// Bestätigung gesendet? Aus History ableiten: die Karte lief durch die
// "Bestätigung senden"-Schleife (Entwurf in Outlook erstellt). Kein neues Sheet-Feld.
function bestaetigungGesendet(a) {
  return (a.history || []).some((e) => e && e.aktion === 'Schritt' && typeof e.details === 'string' && e.details.includes('Entwurf in Outlook erstellt'));
}
// Zeitpunkt der Erledigung: letzter History-Eintrag, der den Status auf "Erledigt" gesetzt hat.
function erledigtAm(a) {
  const treffer = (a.history || []).filter((e) => e && e.aktion === 'Status' && typeof e.details === 'string' && e.details.includes('Erledigt') && e.zeitstempel);
  if (!treffer.length) return null;
  const ts = treffer[treffer.length - 1].zeitstempel;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}
// Tage seit Erledigung (oder null, wenn kein Erledigt-Zeitstempel bekannt).
function tageSeitErledigt(a) {
  const d = erledigtAm(a);
  if (!d) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}
function followupFaellig(a) {
  if (!a.followupDatum) return false;
  const ziel = a.followupDatum + (a.followupZeit ? 'T'+a.followupZeit : 'T23:59');
  return new Date(ziel) < new Date() && a.status !== 'Erledigt';
}
const istHeute = (d) => d === heute();

// Telefonnummer auf E.164 (+49...) normalisieren — fuer sauberen SMS-Versand
function normalizeTelefon(roh) {
  if (!roh) return '';
  let n = String(roh).trim();
  // Alles ausser Ziffern und fuehrendem + entfernen
  const hatPlus = n.startsWith('+');
  n = n.replace(/[^0-9]/g, '');
  if (!n) return '';
  // 00-Praefix (international) -> entfernen
  if (n.startsWith('00')) n = n.slice(2);
  // bereits mit 49 -> so lassen
  if (n.startsWith('49')) return '+' + n;
  // mit fuehrender 0 (nationale Schreibweise) -> 0 weg, +49
  if (n.startsWith('0')) return '+49' + n.slice(1);
  // "nackte" Nummer (z.B. 1795424393, fuehrende 0 von Sheets verschluckt) -> +49
  if (n.startsWith('1') || hatPlus) return '+49' + n;
  // Fallback: unveraendert mit + (z.B. auslaendische Nummer)
  return '+' + n;
}

// ====================================================================
// Haupt-Komponente
// ====================================================================
export default function App() {
  const [anfragen, setAnfragen] = useState([]);
  const [notizen, setNotizen] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(() => localStorage.getItem('currentUser') || 'Luca');
  const [showNewForm, setShowNewForm] = useState(false);
  const [selectedAnfrage, setSelectedAnfrage] = useState(null);
  const [weiterleitenAnfrage, setWeiterleitenAnfrage] = useState(null);
  const [ergebnisAnfrage, setErgebnisAnfrage] = useState(null);
  const [mailtoAnfrage, setMailtoAnfrage] = useState(null); // { anfrage, ergebnis } für E-Mail-Modal
  const [error, setError] = useState(null);
  const [letzteAenderung, setLetzteAenderung] = useState(null);
  const [ansicht, setAnsicht] = useState('aktiv'); // 'aktiv' | 'muelleimer'

  const isReadOnly = READ_ONLY_USERS.includes(currentUser);

  useEffect(() => { loadFromSheets(); loadNotes(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { localStorage.setItem('currentUser', currentUser); }, [currentUser]);
  useEffect(() => {
    const t = setInterval(() => { loadFromSheets(); loadNotes(); }, 60000);
    return () => clearInterval(t); /* eslint-disable-next-line */
  }, []);

  const loadFromSheets = useCallback(async (versuch=0) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(API_URL, { method:'GET' });
      if (res.status === 403) throw new Error('Keine Berechtigung fuer Google Sheet');
      if (res.status === 429) throw new Error('Zu viele Anfragen. Bitte warten...');
      if (!res.ok) throw new Error('Verbindung fehlgeschlagen');
      const json = await res.json();
      const data = Array.isArray(json.data) ? json.data : [];
      const migriert = data.map((a) => {
        let s = a.status;
        if (s === 'Neu') s = 'Offen';
        else if (s === 'Angeboten') s = 'In Bearbeitung';
        return { ...a, status: s, telefon: normalizeTelefon(a.telefon) };
      });
      // Alle Daten bleiben erhalten (auch ältere Erledigte) → für spätere Auswertung.
      // Die Begrenzung auf 14 Tage erfolgt NUR bei der Archiv-Anzeige, nicht beim
      // Laden/Speichern. Damit fällt nichts mehr aus dem Sheet.
      setAnfragen(migriert); setLetzteAenderung(new Date());
    } catch (e) {
      if (versuch < 2) { setTimeout(() => loadFromSheets(versuch+1), 3000); return; }
      setError(e.message || 'Verbindung fehlgeschlagen');
    } finally { setLoading(false); }
  }, []);

  const loadNotes = useCallback(async () => {
    try {
      const res = await fetch(NOTES_URL, { method:'GET' });
      if (!res.ok) return;
      const json = await res.json();
      setNotizen(Array.isArray(json.data) ? json.data : []);
    } catch { /* optional */ }
  }, []);

  const saveToSheets = useCallback(async (data) => {
    try {
      const res = await fetch(API_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ anfragen: data }) });
      if (!res.ok) throw new Error('Speichern fehlgeschlagen');
      setLetzteAenderung(new Date());
    } catch { setError('Verbindung fehlgeschlagen - Aenderung evtl. nicht gespeichert'); }
  }, []);
  const persist = (data) => { setAnfragen(data); saveToSheets(data); };

  const saveNotes = useCallback(async (data) => {
    try { await fetch(NOTES_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ notizen: data }) }); setLetzteAenderung(new Date()); }
    catch { setError('Notiz konnte evtl. nicht gespeichert werden'); }
  }, []);
  const persistNotes = (data) => { setNotizen(data); saveNotes(data); };

  const checkDuplicate = (name, telefon) =>
    anfragen.find((a) => a.name.toLowerCase() === name.toLowerCase() && a.telefon === telefon && !['Erledigt','Weitergeleitet'].includes(a.status));

  const addAnfrage = (data) => {
    const neu = {
      id: neueId(), eingangsdatum: heute(), quelle: data.quelle, name: data.name,
      telefon: normalizeTelefon(data.telefon), email: data.email || '', anliegen: data.anliegen,
      prioritaet: data.prioritaet, status: 'Offen', bearbeiter: 'Unzugewiesen',
      schritt: '', followupDatum:'', followupZeit:'', notizen:'', ergebnis:'',
      history: [historyEintrag('Erstellt', currentUser, 'Manuell erfasst')], reminderStatus:'', weitergeleitetAn:'', letzterReminder:'',
    };
    persist([...anfragen, neu]); setShowNewForm(false);
  };
  const mergeAnfrage = (best, data) => {
    persist(anfragen.map((a) => a.id===best.id ? { ...a, anliegen: a.anliegen+' | '+data.anliegen, history:[...a.history, historyEintrag('Aktualisiert', currentUser, 'Erneute Anfrage zusammengefuehrt')] } : a));
    setShowNewForm(false);
  };
  const updateAnfrage = (updated, besch='Aktualisiert') => {
    // Im Modal auf "Erledigt" gesetzt, aber noch kein Ergebnis → Pflicht-Popup
    if (updated.status === 'Erledigt' && !updated.ergebnis) {
      setErgebnisAnfrage({ ...updated, telefon: normalizeTelefon(updated.telefon) });
      return;
    }
    // Erledigt MIT Ergebnis über cardErledigt leiten → einheitliche Ausfallrechnung-Logik
    if (updated.status === 'Erledigt' && updated.ergebnis) {
      cardErledigt({ ...updated, telefon: normalizeTelefon(updated.telefon), status: anfragen.find((a)=>a.id===updated.id)?.status || updated.status }, updated.ergebnis);
      return;
    }
    const norm = { ...updated, telefon: normalizeTelefon(updated.telefon) };
    persist(anfragen.map((a) => a.id===norm.id ? { ...norm, history:[...(norm.history||[]), historyEintrag('Aktualisiert', currentUser, besch)] } : a));
    setSelectedAnfrage(null);
  };

  // Karten-Aktionen (Workflow-Buttons)
  const cardMove = (anfrage, neuerStatus) => {
    if (neuerStatus === 'Erledigt') {
      // Ergebnis bereits gesetzt (z.B. Ausfallrechnung-Fall): direkt abschließen, kein Popup.
      if (anfrage.ergebnis) { cardErledigt(anfrage, anfrage.ergebnis); return; }
      // Sonst Pflicht-Popup öffnen statt direkt verschieben.
      setErgebnisAnfrage(anfrage); return;
    }
    persist(anfragen.map((a) => a.id===anfrage.id ? {
      ...a, status: neuerStatus,
      bearbeiter: (neuerStatus==='In Bearbeitung' && a.bearbeiter==='Unzugewiesen') ? currentUser : a.bearbeiter,
      history:[...a.history, historyEintrag('Status', currentUser, a.status+' → '+neuerStatus)]
    } : a));
  };
  // Abschluss mit Ergebnis (aus dem Pflicht-Popup)
  const cardErledigt = (anfrage, ergebnis) => {
    // Sonderfall: kurzfristige Absage MIT Ausfallrechnung → nicht erledigen,
    // sondern in To Do mit Schritt "Ausfallrechnung schreiben". Ergebnis wird
    // schon gespeichert. Erst der nächste Erledigt-Klick schließt ab (ohne Popup,
    // da ergebnis dann bereits gesetzt ist).
    // Greift nur beim ERSTEN Mal: ist die Karte schon im Ausfallrechnung-To-Do,
    // ist dieser Klick die Bestätigung → normal abschließen.
    const schonImAusfall = anfrage.status === 'To Do' && anfrage.schritt === 'Ausfallrechnung schreiben' && anfrage.ergebnis === ERGEBNIS_AUSFALLRECHNUNG;
    if (ergebnis === ERGEBNIS_AUSFALLRECHNUNG && !schonImAusfall) {
      persist(anfragen.map((a) => a.id===anfrage.id ? {
        ...a, ...anfrage, status: 'To Do', ergebnis, schritt: 'Ausfallrechnung schreiben',
        bearbeiter: (anfrage.bearbeiter && anfrage.bearbeiter!=='Unzugewiesen') ? anfrage.bearbeiter : currentUser,
        history:[...(anfrage.history || a.history || []), historyEintrag('Ergebnis', currentUser, ergebnis), historyEintrag('Schritt', currentUser, 'Ausfallrechnung schreiben (vor Abschluss)')]
      } : a));
      setErgebnisAnfrage(null); setSelectedAnfrage(null);
      return;
    }
    // Sonderfall: Termin-Ergebnis MIT E-Mail → nicht direkt abschließen, sondern
    // zuerst den Terminbestätigungs-Entwurf anbieten. Die Karte bleibt vorerst
    // unverändert; erst die DraftModal-Aktion entscheidet, wohin sie geht
    // (To Do „Bestätigung senden" bei Erfolg, direkt Erledigt bei „Keine E-Mail").
    // Greift nur beim ERSTEN Mal: hängt die Karte schon in der Bestätigungs-Schleife,
    // ist dieser Klick die Bestätigung „ist versendet" → normal abschließen.
    const schonInBestaetigung = anfrage.status === 'To Do' && BESTAETIGUNG_SCHRITTE.includes(anfrage.schritt);
    if (istTerminErgebnis(ergebnis) && anfrage.email && anfrage.email.trim() && !schonInBestaetigung) {
      setErgebnisAnfrage(null); setSelectedAnfrage(null);
      setMailtoAnfrage({ anfrage: { ...anfrage, ergebnis }, ergebnis });
      return;
    }
    persist(anfragen.map((a) => a.id===anfrage.id ? {
      ...a, ...anfrage, status: 'Erledigt', ergebnis,
      bearbeiter: (anfrage.bearbeiter && anfrage.bearbeiter!=='Unzugewiesen') ? anfrage.bearbeiter : currentUser,
      history:[...(anfrage.history || a.history || []), historyEintrag('Status', currentUser, (anfrage.status||a.status)+' → Erledigt'), historyEintrag('Ergebnis', currentUser, ergebnis)]
    } : a));
    setErgebnisAnfrage(null); setSelectedAnfrage(null);
  };

  // Folgeaktionen aus dem DraftModal (Terminbestätigung)
  // Erfolg: Karte nach To Do mit Schritt „Bestätigung senden" (sichtbar, bis versendet).
  const draftErfolg = (anfrage, ergebnis) => {
    persist(anfragen.map((a) => a.id===anfrage.id ? {
      ...a, ...anfrage, status: 'To Do', ergebnis, schritt: SCHRITT_BESTAETIGUNG,
      bearbeiter: (anfrage.bearbeiter && anfrage.bearbeiter!=='Unzugewiesen') ? anfrage.bearbeiter : currentUser,
      history:[...(anfrage.history || a.history || []), historyEintrag('Ergebnis', currentUser, ergebnis), historyEintrag('Schritt', currentUser, SCHRITT_BESTAETIGUNG+' (Entwurf in Outlook erstellt)')]
    } : a));
    setMailtoAnfrage(null); setSelectedAnfrage(null);
  };
  // „Keine E-Mail": Patient kriegt bewusst keine Bestätigung → direkt abschließen.
  const draftKeineEmail = (anfrage, ergebnis) => {
    persist(anfragen.map((a) => a.id===anfrage.id ? {
      ...a, ...anfrage, status: 'Erledigt', ergebnis,
      bearbeiter: (anfrage.bearbeiter && anfrage.bearbeiter!=='Unzugewiesen') ? anfrage.bearbeiter : currentUser,
      history:[...(anfrage.history || a.history || []), historyEintrag('Status', currentUser, (anfrage.status||a.status)+' → Erledigt'), historyEintrag('Ergebnis', currentUser, ergebnis), historyEintrag('Bestätigung', currentUser, 'keine E-Mail gewünscht')]
    } : a));
    setMailtoAnfrage(null); setSelectedAnfrage(null);
  };
  const cardSetSchritt = (anfrage, schritt) => {
    persist(anfragen.map((a) => a.id===anfrage.id ? { ...a, schritt, history:[...a.history, historyEintrag('Schritt', currentUser, schritt)] } : a));
  };
  const weiterleiten = (anfrage, an) => {
    persist(anfragen.map((a) => a.id===anfrage.id ? {
      ...a, status:'Weitergeleitet', weitergeleitetAn: an, reminderStatus:'',
      history:[...a.history, historyEintrag('Weitergeleitet', currentUser, 'an '+an)]
    } : a));
    setWeiterleitenAnfrage(null); setSelectedAnfrage(null);
  };
  const deleteAnfrage = (anfrage) => {
    if (!window.confirm('Anfrage von '+anfrage.name+' wirklich loeschen?')) return;
    persist(anfragen.filter((a) => a.id!==anfrage.id)); setSelectedAnfrage(null);
  };

  const addNotiz = (text) => { if (!text.trim()) return; persistNotes([...notizen, { id:neueId(), text:text.trim(), autor:currentUser, zeit:jetztISO() }]); };
  const deleteNotiz = (id) => persistNotes(notizen.filter((n) => n.id!==id));

  // Sichtbar im Board: alles ausser Erledigt + Weitergeleitet
  const sichtbar = anfragen.filter((a) => !['Erledigt','Weitergeleitet'].includes(a.status));
  // Mülleimer: erledigte Anfragen der letzten 14 Tage (jüngste zuerst)
  const muelleimer = anfragen
    .filter((a) => a.status === 'Erledigt' && (tageSeitErledigt(a) === null || tageSeitErledigt(a) < 14))
    .sort((x, y) => {
      const dx = erledigtAm(x), dy = erledigtAm(y);
      return (dy ? dy.getTime() : 0) - (dx ? dx.getTime() : 0);
    });
  // Aus dem Mülleimer zurückholen → zurück auf "Offen"
  const zurueckholen = (anfrage) => {
    persist(anfragen.map((a) => a.id===anfrage.id ? {
      ...a, status:'Offen',
      history:[...(a.history||[]), historyEintrag('Status', currentUser, 'Erledigt → Offen (aus Mülleimer)')]
    } : a));
  };
  const offeneCount = sichtbar.filter((a) => a.status==='Offen').length;
  const sofortCount = sichtbar.filter((a) => a.prioritaet==='Sofort').length;
  const erledigtHeute = useMemo(() => anfragen.filter((a) => a.status==='Erledigt' && istHeute(a.eingangsdatum)).length, [anfragen]);
  const weitergeleitetHeute = useMemo(() => anfragen.filter((a) => a.status==='Weitergeleitet' && istHeute(a.eingangsdatum)).length, [anfragen]);

  return (
    <div className="app-shell">
      <div className="panel">
        <Kopfzeile
          offeneCount={offeneCount} sofortCount={sofortCount}
          erledigtHeute={erledigtHeute} weitergeleitetHeute={weitergeleitetHeute}
          letzteAenderung={letzteAenderung} currentUser={currentUser}
          setCurrentUser={setCurrentUser} isReadOnly={isReadOnly}
          onNeu={() => setShowNewForm(true)} onRefresh={() => { loadFromSheets(); loadNotes(); }}
        />
        {error && (
          <div className="fehler-leiste"><span>{error}</span><button onClick={() => loadFromSheets()}>Erneut versuchen</button></div>
        )}
        <main className="board-bereich">
          <div className="ansicht-tabs">
            <button className={'ansicht-tab'+(ansicht==='aktiv'?' aktiv':'')} onClick={() => setAnsicht('aktiv')}>
              <Inbox size={14} /> Aktiv
            </button>
            <button className={'ansicht-tab'+(ansicht==='muelleimer'?' aktiv':'')} onClick={() => setAnsicht('muelleimer')}>
              <Archive size={14} /> Archiv{muelleimer.length ? ' ('+muelleimer.length+')' : ''}
            </button>
          </div>
          {loading && anfragen.length===0 ? (
            <div className="lade-zustand"><div className="spinner" /><span>Daten laden…</span></div>
          ) : ansicht==='aktiv' ? (
            <div className="spalten-grid">
              {SPALTEN.map((status) => (
                <StatusSpalte key={status} status={status}
                  anfragen={sichtbar.filter((a) => a.status===status)}
                  isReadOnly={isReadOnly} onCardClick={setSelectedAnfrage}
                  onMove={cardMove} onSetSchritt={cardSetSchritt} onWeiterleiten={setWeiterleitenAnfrage} />
              ))}
            </div>
          ) : (
            <Muelleimer anfragen={muelleimer} isReadOnly={isReadOnly}
              onCardClick={setSelectedAnfrage} onZurueckholen={zurueckholen} />
          )}
          <UebergabeNotizen notizen={notizen} isReadOnly={isReadOnly} onAdd={addNotiz} onDelete={deleteNotiz} />
        </main>

        {selectedAnfrage && (
          <AnfragenModal anfrage={selectedAnfrage} isReadOnly={isReadOnly}
            onClose={() => setSelectedAnfrage(null)} onSave={updateAnfrage}
            onStatusChange={(a,s) => cardMove(a,s)} onDelete={deleteAnfrage}
            onWeiterleiten={() => setWeiterleitenAnfrage(selectedAnfrage)} />
        )}
        {weiterleitenAnfrage && (
          <WeiterleitenModal anfrage={weiterleitenAnfrage} onClose={() => setWeiterleitenAnfrage(null)} onConfirm={weiterleiten} />
        )}
        {ergebnisAnfrage && (
          <ErgebnisModal anfrage={ergebnisAnfrage} onClose={() => setErgebnisAnfrage(null)} onConfirm={cardErledigt} />
        )}
        {mailtoAnfrage && (
          <DraftModal anfrage={mailtoAnfrage.anfrage} ergebnis={mailtoAnfrage.ergebnis}
            onErfolg={() => draftErfolg(mailtoAnfrage.anfrage, mailtoAnfrage.ergebnis)}
            onKeineEmail={() => draftKeineEmail(mailtoAnfrage.anfrage, mailtoAnfrage.ergebnis)}
            onClose={() => setMailtoAnfrage(null)}
            onBack={() => { setMailtoAnfrage(null); setSelectedAnfrage(mailtoAnfrage.anfrage); }} />
        )}
        {showNewForm && !isReadOnly && (
          <NeueAnfrageForm onClose={() => setShowNewForm(false)} onSubmit={addAnfrage} onMerge={mergeAnfrage} checkDuplicate={checkDuplicate} />
        )}
      </div>
    </div>
  );
}

// ====================================================================
// Kopfzeile
// ====================================================================
function Kopfzeile({ offeneCount, sofortCount, erledigtHeute, weitergeleitetHeute, letzteAenderung, currentUser, setCurrentUser, isReadOnly, onNeu, onRefresh }) {
  const aenderungsZeit = letzteAenderung ? letzteAenderung.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}) : '—';
  return (
    <div className="kopfzeile">
      <div className="kopf-links">
        <div>
          <h1 className="kopf-titel">Rezeptionsdashboard</h1>
          <button className="kopf-zeitstempel" onClick={onRefresh} title="Jetzt aktualisieren">
            <RefreshCw size={10} /> Letzte Änderung {aenderungsZeit}
          </button>
        </div>
        <div className="chip-gruppe">
          <div className="chip chip-gruen"><Check size={13} /><span>{erledigtHeute} erledigt</span></div>
          {weitergeleitetHeute > 0 && (
            <div className="chip chip-lila"><Send size={13} /><span>{weitergeleitetHeute} weitergeleitet</span></div>
          )}
        </div>
      </div>
      <div className="kopf-rechts">
        <span className="kopf-stats">{offeneCount} offen{sofortCount>0 ? ' · '+sofortCount+' sofort' : ''}</span>
        <select className="user-select" aria-label="Benutzer" value={currentUser} onChange={(e) => setCurrentUser(e.target.value)}>
          {ALLE_USER.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        {!isReadOnly && <button className="neu-btn" onClick={onNeu}><Plus size={14} /> Neue Anfrage</button>}
      </div>
    </div>
  );
}

// ====================================================================
// StatusSpalte (Box mit farbigem Kopf)
// ====================================================================
function StatusSpalte({ status, anfragen, isReadOnly, onCardClick, onMove, onSetSchritt, onWeiterleiten }) {
  const meta = SPALTEN_META[status];
  const Icon = meta.icon;
  return (
    <section className="spalte-box" style={{ background: meta.box, borderColor: meta.rand }}>
      <div className="spalte-kopf" style={{ background: meta.farbe }}>
        <span className="spalte-titel"><Icon size={15} /> {status}</span>
        <span className="spalte-zaehler" style={{ color: meta.farbe }}>{anfragen.length}</span>
      </div>
      <div className="spalte-karten">
        {anfragen.map((a) => (
          <AnfragenKarte key={a.id} anfrage={a} spalte={status} isReadOnly={isReadOnly}
            onClick={() => onCardClick(a)} onMove={onMove} onSetSchritt={onSetSchritt} onWeiterleiten={onWeiterleiten} />
        ))}
        {anfragen.length===0 && <p className="spalte-leer">Keine Einträge</p>}
      </div>
    </section>
  );
}

// ====================================================================
// AnfragenKarte (mit Workflow-Buttons + Schritt-Etikett)
// ====================================================================
function AnfragenKarte({ anfrage, spalte, isReadOnly, onClick, onMove, onSetSchritt, onWeiterleiten }) {
  const [schrittOffen, setSchrittOffen] = useState(false);
  const prio = PRIO_STYLE[anfrage.prioritaet] || PRIO_STYLE.Normal;
  const istTodo = spalte==='To Do';
  const istBearb = spalte==='In Bearbeitung';
  const faellig = followupFaellig(anfrage);
  const stop = (e, fn) => { e.stopPropagation(); fn(); };
  const schritte = istTodo ? SCHRITTE_HAENGT : SCHRITTE_AKTIV;

  return (
    <div className={'karte'+(istTodo?' karte-todo':'')} onClick={onClick}
      style={{ borderLeftColor: istTodo ? '#d99a3a' : prio.rand }}>
      <div className="karte-kopf">
        <span className="karte-name">{anfrage.name}</span>
        {istTodo ? <AlertTriangle size={12} color="#b8742a" />
          : <span className="karte-prio" style={{ color:prio.text, background:prio.bg }}>{anfrage.prioritaet}</span>}
      </div>
      <p className="karte-anliegen">{anfrage.anliegen}</p>

      {(istBearb || istTodo) && (
        <div className="karte-schritt-zeile" onClick={(e) => e.stopPropagation()}>
          {anfrage.schritt ? (
            <span className={'schritt-etikett'+(istTodo?' etikett-todo':'')}>{anfrage.schritt}</span>
          ) : (
            <span className="schritt-leer">Kein Schritt gewählt</span>
          )}
          {!isReadOnly && (
            <button className="schritt-aendern" onClick={() => setSchrittOffen((v) => !v)}>▾ ändern</button>
          )}
          {schrittOffen && !isReadOnly && (
            <div className="schritt-menue">
              {schritte.map((s) => (
                <button key={s} onClick={() => { onSetSchritt(anfrage, s); setSchrittOffen(false); }}>{s}</button>
              ))}
              {anfrage.schritt && <button className="schritt-loeschen" onClick={() => { onSetSchritt(anfrage,''); setSchrittOffen(false); }}>Etikett entfernen</button>}
            </div>
          )}
        </div>
      )}

      <div className="karte-meta">
        {anfrage.telefon && <span className="karte-tel"><Phone size={12} /> {anfrage.telefon}</span>}
        <span className="karte-zeit"><Clock size={12} /> {eingangLabel(anfrage)}{eingangsZeit(anfrage) ? ' · ' + eingangsZeit(anfrage) : ''}{fristStatus(anfrage) && <span className={'karte-frist-punkt karte-frist-' + fristStatus(anfrage)} title={fristStatus(anfrage) === 'rot' ? 'Über 60 Min seit Eingang' : 'Unter 60 Min seit Eingang'} />}</span>
        {anfrage.bearbeiter && anfrage.bearbeiter!=='Unzugewiesen' && <span className="karte-bearb"><User size={12} /> {anfrage.bearbeiter}</span>}
      </div>

      {anfrage.schritt === SCHRITT_BESTAETIGUNG && (
        <div className="karte-best-chip karte-best-offen">
          <Mail size={11} />
          <span>Bestätigung offen – senden</span>
        </div>
      )}

      {anfrage.utm_source && (
        <div className="karte-ads-chip">
          <Megaphone size={11} />
          <span>
            {anfrage.utm_source}{anfrage.utm_medium ? ' / ' + anfrage.utm_medium : ''}
            {anfrage.utm_campaign ? ' — ' + anfrage.utm_campaign : ''}
            {anfrage.utm_content ? ' · ' + anfrage.utm_content : ''}
          </span>
        </div>
      )}

      {anfrage.notizen && (
        <div className={'karte-notiz'+(istTodo?' notiz-todo':'')}><StickyNote size={11} /> {anfrage.notizen}</div>
      )}
      {anfrage.followupDatum && (
        <div className={'karte-followup'+(faellig?' faellig':'')}>
          <Calendar size={11} /> Follow-up {anfrage.followupDatum} {anfrage.followupZeit}
        </div>
      )}

      {!isReadOnly && (
        <div className="karte-aktionen" onClick={(e) => e.stopPropagation()}>
          {spalte==='Offen' && (
            <>
              <button className="akt-haupt" onClick={(e) => stop(e, () => onMove(anfrage,'In Bearbeitung'))}>Übernehmen <ArrowRight size={12} /></button>
              <button className="akt-lila" title="An Oliver/Hanna weiterleiten" onClick={(e) => stop(e, () => onWeiterleiten(anfrage))}><Send size={12} /></button>
            </>
          )}
          {spalte==='In Bearbeitung' && (
            <>
              <button className="akt-grau" title="Zurück zu Offen" onClick={(e) => stop(e, () => onMove(anfrage,'Offen'))}><ArrowLeft size={12} /></button>
              <button className="akt-todo" onClick={(e) => stop(e, () => onMove(anfrage,'To Do'))}>To Do <ArrowRight size={12} /></button>
              <button className="akt-fertig" title="Erledigt" onClick={(e) => stop(e, () => onMove(anfrage,'Erledigt'))}><Check size={12} /></button>
            </>
          )}
          {spalte==='To Do' && (
            <>
              <button className="akt-grau" title="Zurück zu In Bearbeitung" onClick={(e) => stop(e, () => onMove(anfrage,'In Bearbeitung'))}><ArrowLeft size={12} /></button>
              <button className="akt-fertig akt-breit" onClick={(e) => stop(e, () => onMove(anfrage,'Erledigt'))}><Check size={12} /> Erledigt</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ====================================================================
// Muelleimer
// ====================================================================
function Muelleimer({ anfragen, isReadOnly, onCardClick, onZurueckholen }) {
  if (!anfragen.length) {
    return (
      <div className="muelleimer-leer">
        <Archive size={28} />
        <p>Noch keine abgeschlossenen Anfragen.</p>
        <span>Abgeschlossene Anfragen werden hier archiviert und können zurückgeholt werden.</span>
      </div>
    );
  }
  return (
    <div className="muelleimer">
      <div className="muelleimer-hinweis">
        <Archive size={13} /> Abgeschlossene Anfragen der letzten 14 Tage.
      </div>
      <div className="muelleimer-liste">
        {anfragen.map((a) => {
          const tage = tageSeitErledigt(a);
          const d = erledigtAm(a);
          const wann = d ? d.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'}) + ' · ' + uhrzeit(d.toISOString()) : '—';
          const verbleibend = tage === null ? null : Math.max(0, 14 - tage);
          return (
            <div className="muell-karte" key={a.id} onClick={() => onCardClick(a)}>
              <div className="muell-haupt">
                <span className="muell-name">{a.name || '(ohne Name)'}</span>
                <span className="muell-anliegen">{a.anliegen}</span>
                {a.ergebnis && (
                  <span className={'muell-ergebnis'+(istTerminErgebnis(a.ergebnis)?' muell-ergebnis-termin':'')+(istAbsage(a.ergebnis)?' muell-ergebnis-absage':'')}>
                    {istTerminErgebnis(a.ergebnis) ? <CalendarCheck size={11} /> : istAbsage(a.ergebnis) ? <CalendarX size={11} /> : <CheckCircle2 size={11} />} {a.ergebnis}
                  </span>
                )}
                {bestaetigungGesendet(a) && (
                  <span className="muell-best-chip"><Mail size={11} /> Entwurf erstellt</span>
                )}
                <span className="muell-meta">
                  <Check size={11} /> erledigt {wann}
                  {verbleibend !== null && <span className="muell-rest"> · noch {verbleibend} Tag{verbleibend===1?'':'e'}</span>}
                </span>
              </div>
              {!isReadOnly && (
                <button className="muell-zurueck" title="Zurückholen" onClick={(e) => { e.stopPropagation(); onZurueckholen(a); }}>
                  <RotateCcw size={13} /> Zurückholen
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ====================================================================
// UebergabeNotizen
// ====================================================================
function UebergabeNotizen({ notizen, isReadOnly, onAdd, onDelete }) {
  const [text, setText] = useState('');
  const [offen, setOffen] = useState(true);
  const absenden = () => { if (text.trim()) { onAdd(text); setText(''); } };
  return (
    <div className="notizen-box">
      <button className="notizen-kopf" onClick={() => setOffen((v) => !v)}>
        <span className="notizen-titel"><StickyNote size={15} /> Übergabe-Notizen</span>
        <span className="notizen-sub">für die nächste Schicht {offen ? '▾' : '▸'}</span>
      </button>
      {offen && (
        <>
          <div className="notizen-liste">
            {notizen.length===0 && <p className="notizen-leer">Noch keine Notizen für die Übergabe.</p>}
            {notizen.map((n) => (
              <div className="notiz" key={n.id}>
                <span className="notiz-punkt" />
                <div className="notiz-inhalt">
                  <div className="notiz-text">{n.text}</div>
                  <div className="notiz-meta">{uhrzeit(n.zeit)} · {n.autor}</div>
                </div>
                {!isReadOnly && <button className="notiz-loeschen" onClick={() => onDelete(n.id)} aria-label="Notiz loeschen"><X size={13} /></button>}
              </div>
            ))}
          </div>
          {!isReadOnly && (
            <div className="notiz-neu">
              <input type="text" value={text} placeholder="Notiz für die nächste Schicht hinzufügen …"
                onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key==='Enter') absenden(); }} />
              <button onClick={absenden} disabled={!text.trim()}><Plus size={14} /></button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ====================================================================
// WeiterleitenModal
// ====================================================================
function WeiterleitenModal({ anfrage, onClose, onConfirm }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-schmal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-kopf modal-kopf-lila">
          <h2>Anfrage weiterleiten</h2>
          <button onClick={onClose} aria-label="Schliessen"><X size={20} /></button>
        </div>
        <div className="modal-body">
          <p className="wl-text">Anfrage von <strong>{anfrage.name}</strong> per E-Mail weiterleiten an:</p>
          <div className="wl-buttons">
            <button onClick={() => onConfirm(anfrage,'Oliver Wrobel')}><User size={16} /> Oliver Wrobel</button>
            <button onClick={() => onConfirm(anfrage,'Hanna Wrobel')}><User size={16} /> Hanna Wrobel</button>
          </div>
          <p className="wl-hinweis">Die Anfrage verschwindet danach aus dem Board und wird automatisch per E-Mail zugestellt.</p>
        </div>
      </div>
    </div>
  );
}

// ====================================================================
// ====================================================================
// DraftModal — Outlook-Entwurf mit HTML-Mail + PDF-Anhang erstellen
// ====================================================================
function DraftModal({ anfrage, ergebnis, onClose, onBack, onErfolg, onKeineEmail }) {
  const [pdfDatei, setPdfDatei] = useState(null);   // { name, base64 }
  const [status, setStatus] = useState('idle');     // idle | sende | ok | fehler
  const [fehler, setFehler] = useState('');

  // Behandlungsart aus dem Ergebnis ableiten
  const behandlung = ergebnis.includes('Osteopathie') ? 'Osteopathie'
    : ergebnis.includes('Physiocoaching') ? 'Physiocoaching'
    : 'Physiotherapie';

  const onPdfWahl = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (f.type !== 'application/pdf') { setFehler('Bitte eine PDF-Datei auswählen.'); return; }
    if (f.size > 4 * 1024 * 1024) { setFehler('PDF ist größer als 4 MB.'); return; }
    setFehler('');
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result).split(',')[1] || '';
      setPdfDatei({ name: f.name, base64 });
    };
    reader.onerror = () => setFehler('PDF konnte nicht gelesen werden.');
    reader.readAsDataURL(f);
  };

  const entwurfErstellen = async () => {
    setStatus('sende'); setFehler('');
    try {
      const res = await fetch('/.netlify/functions/draft-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: anfrage.name,
          email: anfrage.email,
          behandlung,
          pdfBase64: pdfDatei ? pdfDatei.base64 : null,
          pdfName: pdfDatei ? pdfDatei.name : null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || ('Fehler ' + res.status));
      }
      setStatus('ok');
      onErfolg && onErfolg();
    } catch (e) {
      setStatus('fehler');
      setFehler(e.message || 'Entwurf konnte nicht erstellt werden.');
    }
  };

  // Erfolgs-Ansicht
  if (status === 'ok') {
    return (
      <div className="modal-overlay">
        <div className="modal modal-schmal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-kopf modal-kopf-gruen">
            <h2><Check size={17} style={{ verticalAlign:'-3px', marginRight:6 }} /> Entwurf erstellt</h2>
          </div>
          <div className="modal-body">
            <div className="draft-ok">
              <CheckCircle2 size={40} />
              <p className="draft-ok-titel">Der Entwurf liegt in Outlook bereit</p>
              <p className="draft-ok-text">
                Öffne in Outlook das Postfach <strong>info@physioproluebeck.de</strong> →
                Ordner <strong>Entwürfe</strong>. Dort kannst du die Mail an
                <strong> {anfrage.name}</strong> prüfen{pdfDatei ? ' (PDF ist angehängt)' : ''} und senden.
              </p>
              <p className="draft-ok-text" style={{ marginTop:10 }}>
                Die Karte bleibt so lange in <strong>To Do</strong> („Bestätigung senden"),
                bis du sie nach dem Versenden auf <strong>Erledigt</strong> setzt.
              </p>
            </div>
          </div>
          <div className="modal-fuss">
            <span />
            <button className="speichern-btn" onClick={onClose}>Fertig</button>
          </div>
        </div>
      </div>
    );
  }

  const sendet = status === 'sende';
  return (
    <div className="modal-overlay">
      <div className="modal modal-schmal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-kopf modal-kopf-gruen">
          <h2><Mail size={17} style={{ verticalAlign:'-3px', marginRight:6 }} /> Terminbestätigung als Outlook-Entwurf</h2>
        </div>
        <div className="modal-body">
          <p className="erg-name">{anfrage.name}</p>
          <p style={{ fontSize:'0.875rem', color:'var(--grau)', margin:'0 0 4px' }}>HTML-E-Mail ({behandlung}) an</p>
          <p style={{ fontSize:'0.9rem', fontWeight:600, color:'var(--text)', margin:'0 0 18px', wordBreak:'break-all' }}>
            {anfrage.email}
          </p>

          <label className="draft-pdf-feld">
            <input type="file" accept="application/pdf" onChange={onPdfWahl} disabled={sendet} hidden />
            <span className="draft-pdf-box">
              {pdfDatei
                ? <><FileText size={16} /> {pdfDatei.name} <span className="draft-pdf-wechseln">ändern</span></>
                : <><Plus size={16} /> Termin-PDF auswählen</>}
            </span>
          </label>
          <p className="draft-pdf-hinweis">
            Optional. Das PDF wird automatisch an den Entwurf angehängt.
          </p>

          {fehler && <p className="draft-fehler">{fehler}</p>}
        </div>
        <div className="modal-fuss modal-fuss-3">
          <button className="zurueck-btn" onClick={onBack} disabled={sendet}>
            <ArrowLeft size={15} /> Zurück
          </button>
          <button className="abbrechen-btn" onClick={onKeineEmail} disabled={sendet}>Keine E-Mail</button>
          <button className="speichern-btn" onClick={entwurfErstellen} disabled={sendet}
            style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
            {sendet ? <><Hourglass size={15} /> Erstelle…</> : status === 'fehler' ? <><Mail size={15} /> Nochmal versuchen</> : <><Mail size={15} /> Entwurf erstellen</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ====================================================================
// ErgebnisModal (Pflicht-Auswahl beim Abschließen)
// ====================================================================
function ErgebnisModal({ anfrage, onClose, onConfirm }) {
  const [auswahl, setAuswahl] = useState('');
  const [alleZeigen, setAlleZeigen] = useState(false);
  const gruppen = alleZeigen ? ERGEBNIS_GRUPPEN : ERGEBNIS_GRUPPEN.slice(0, 2);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-schmal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-kopf modal-kopf-gruen">
          <h2><Check size={17} style={{ verticalAlign:'-3px', marginRight:6 }} /> Anfrage abschließen</h2>
          <button onClick={onClose} aria-label="Schliessen"><X size={20} /></button>
        </div>
        <div className="modal-body">
          <p className="erg-name">{anfrage.name}</p>
          <p className="erg-frage">Welches Ergebnis hatte die Anfrage?</p>
          {gruppen.map((g) => (
            <div className="erg-gruppe" key={g.titel}>
              <p className="erg-gruppe-titel">{g.titel}</p>
              <div className="erg-optionen">
                {g.optionen.map((o) => (
                  <button key={o}
                    className={'erg-option'+(auswahl===o?' aktiv':'')+(g.primaer?' erg-primaer':'')}
                    onClick={() => setAuswahl(o)}>
                    {istTerminErgebnis(o) ? <CalendarCheck size={14} /> : istAbsage(o) ? <CalendarX size={14} /> : g.titel.startsWith('Kein') ? <Frown size={14} /> : <FileText size={14} />}
                    {o}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {!alleZeigen && (
            <button className="erg-mehr" onClick={() => setAlleZeigen(true)}>… weitere Gründe</button>
          )}
        </div>
        <div className="modal-fuss">
          <button className="abbrechen-btn" onClick={onClose}>Abbrechen</button>
          <button className="speichern-btn" disabled={!auswahl} onClick={() => auswahl && onConfirm(anfrage, auswahl)}>
            Erledigt
          </button>
        </div>
        {!auswahl && <p className="erg-hinweis">Ohne Auswahl nicht möglich</p>}
      </div>
    </div>
  );
}

// ====================================================================
// AnfragenModal (Detail / Edit)
// ====================================================================
function AnfragenModal({ anfrage, isReadOnly, onClose, onSave, onStatusChange, onDelete, onWeiterleiten }) {
  const [form, setForm] = useState({ ...anfrage });
  const [showHistory, setShowHistory] = useState(false);
  const set = (k,v) => setForm((f) => ({ ...f, [k]: v }));
  const schritte = form.status==='To Do' ? SCHRITTE_HAENGT : SCHRITTE_AKTIV;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-kopf">
          {isReadOnly ? <h2>{anfrage.name}</h2> : (
            <div className="kopf-name-feld">
              <label>Name</label>
              <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Name" />
            </div>
          )}
          <button onClick={onClose} aria-label="Schliessen"><X size={20} /></button>
        </div>
        <div className="modal-body">
          <div className="info-grid">
            <InfoCard icon={<Calendar size={14} />} label="Eingang" value={anfrage.eingangsdatum} />
            <InfoCard icon={<Phone size={14} />} label="Telefon" value={anfrage.telefon || '-'} />
            {isReadOnly
              ? <InfoCard icon={<Mail size={14} />} label="E-Mail" value={anfrage.email || '-'} />
              : (
                <div className="info-card info-card-edit">
                  <span className="info-label"><Mail size={14} />E-Mail <span className="info-label-hint">— nachtragbar</span></span>
                  <input className="info-edit-input" type="email" value={form.email || ''}
                    onChange={(e) => set('email', e.target.value)} placeholder="z. B. name@web.de" />
                </div>
              )}
            <InfoCard icon={<Globe size={14} />} label="Quelle" value={anfrage.quelle} />
            {anfrage.utm_source && (
              <InfoCard icon={<Megaphone size={14} />} label="Werbekanal"
                value={[anfrage.utm_source, anfrage.utm_medium, anfrage.utm_campaign, anfrage.utm_content].filter(Boolean).join(' / ')} />
            )}
          </div>
          <div className="feld">
            <label>Anliegen</label>
            {isReadOnly ? <p className="feld-wert">{anfrage.anliegen}</p>
              : <textarea value={form.anliegen} onChange={(e) => set('anliegen', e.target.value)} rows={2} />}
          </div>
          <div className="feld">
            <label>Status</label>
            {isReadOnly ? <p className="feld-wert">{anfrage.status}</p> : (
              <div className="status-buttons">
                {SPALTEN.concat('Erledigt').map((s) => (
                  <button key={s} className={'status-btn'+(form.status===s?' aktiv':'')} onClick={() => set('status', s)}>{s}</button>
                ))}
              </div>
            )}
          </div>
          {(form.ergebnis || anfrage.ergebnis) && (
            <div className="feld">
              <label>Ergebnis</label>
              <div className="erg-anzeige">
                <span className={'erg-chip'+(istTerminErgebnis(form.ergebnis ?? anfrage.ergebnis)?' erg-chip-termin':'')+(istAbsage(form.ergebnis ?? anfrage.ergebnis)?' erg-chip-absage':'')}>
                  {istTerminErgebnis(form.ergebnis ?? anfrage.ergebnis) ? <CalendarCheck size={13} /> : istAbsage(form.ergebnis ?? anfrage.ergebnis) ? <CalendarX size={13} /> : <CheckCircle2 size={13} />} {form.ergebnis ?? anfrage.ergebnis}
                </span>
                {!isReadOnly && (
                  <button type="button" className="erg-entfernen" title="Ergebnis entfernen"
                    onClick={() => { set('ergebnis', ''); if (BESTAETIGUNG_SCHRITTE.includes(form.schritt ?? anfrage.schritt)) set('schritt', ''); if (form.status === 'Erledigt') set('status', 'In Bearbeitung'); }}>
                    <X size={13} /> entfernen
                  </button>
                )}
              </div>
              {bestaetigungGesendet(anfrage) && (
                <p className="erg-best-hinweis"><Mail size={12} /> Terminbestätigung wurde als Entwurf in Outlook erstellt</p>
              )}
            </div>
          )}
          {(form.status==='In Bearbeitung' || form.status==='To Do') && !isReadOnly && (
            <div className="feld">
              <label>Bearbeitungs-Schritt</label>
              <select value={form.schritt || ''} onChange={(e) => { set('schritt', e.target.value); }}>
                <option value="">– kein Schritt –</option>
                {schritte.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
          )}
          <div className="feld-reihe">
            <div className="feld">
              <label>Priorität</label>
              {isReadOnly ? <p className="feld-wert">{anfrage.prioritaet}</p>
                : <select value={form.prioritaet} onChange={(e) => set('prioritaet', e.target.value)}>{PRIORITAETEN.map((p) => <option key={p}>{p}</option>)}</select>}
            </div>
            <div className="feld">
              <label>Bearbeiter</label>
              {isReadOnly ? <p className="feld-wert">{anfrage.bearbeiter}</p>
                : <select value={form.bearbeiter} onChange={(e) => set('bearbeiter', e.target.value)}>{BEARBEITER.map((b) => <option key={b}>{b}</option>)}</select>}
            </div>
          </div>
          <div className="feld-reihe">
            <div className="feld">
              <label>Follow-up Datum</label>
              {isReadOnly ? <p className="feld-wert">{anfrage.followupDatum || '-'}</p>
                : <input type="date" value={form.followupDatum || ''} onChange={(e) => set('followupDatum', e.target.value)} />}
            </div>
            <div className="feld">
              <label>Uhrzeit</label>
              {isReadOnly ? <p className="feld-wert">{anfrage.followupZeit || '-'}</p> : (
                <select value={form.followupZeit || ''} onChange={(e) => set('followupZeit', e.target.value)}>
                  <option value="">– keine –</option>
                  {ZEIT_SLOTS.map((z) => <option key={z} value={z}>{z}</option>)}
                </select>
              )}
            </div>
          </div>
          <div className="feld">
            <label>Notizen</label>
            {isReadOnly ? <p className="feld-wert">{anfrage.notizen || '-'}</p>
              : <textarea value={form.notizen || ''} onChange={(e) => set('notizen', e.target.value)} rows={3} />}
          </div>
          <button className="history-toggle" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Änderungs-History ({(anfrage.history||[]).length})
          </button>
          {showHistory && (
            <div className="history-liste">
              {(anfrage.history||[]).slice().reverse().map((h,i) => (
                <div className="history-eintrag" key={i}>
                  <span className="history-zeit">{uhrzeit(h.zeitstempel)}</span>
                  <span className="history-text"><strong>{h.aktion}</strong> · {h.von}{h.details ? ' · '+h.details : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {!isReadOnly && (
          <div className="modal-fuss">
            <button className="loeschen-btn" onClick={() => onDelete(anfrage)}><Trash2 size={14} /> Löschen</button>
            <div className="fuss-rechts">
              <button className="wl-btn" onClick={onWeiterleiten}><Send size={14} /> Weiterleiten</button>
              <button className="speichern-btn" onClick={() => onSave(form)}>Speichern</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoCard({ icon, label, value }) {
  return (
    <div className="info-card">
      <span className="info-label">{icon}{label}</span>
      <span className="info-wert">{value}</span>
    </div>
  );
}

// ====================================================================
// NeueAnfrageForm
// ====================================================================
function NeueAnfrageForm({ onClose, onSubmit, onMerge, checkDuplicate }) {
  const [form, setForm] = useState({ name:'', telefon:'', email:'', anliegen:'', prioritaet:'Normal', quelle:'Manuell erfasst' });
  const [duplikat, setDuplikat] = useState(null);
  const set = (k,v) => setForm((f) => ({ ...f, [k]: v }));
  const absenden = () => {
    if (!form.name.trim()) { alert('Name ist erforderlich'); return; }
    const dup = checkDuplicate(form.name, form.telefon);
    if (dup && !duplikat) { setDuplikat(dup); return; }
    onSubmit(form);
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-schmal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-kopf">
          <h2>Neue Anfrage</h2>
          <button onClick={onClose} aria-label="Schliessen"><X size={20} /></button>
        </div>
        <div className="modal-body">
          {duplikat && (
            <div className="duplikat-warnung">
              <AlertTriangle size={16} />
              <div><strong>Mögliches Duplikat:</strong> {duplikat.name} ({duplikat.telefon}) existiert bereits.
                <div className="duplikat-aktionen">
                  <button onClick={() => onMerge(duplikat, form)}>Zusammenführen</button>
                  <button onClick={() => onSubmit(form)}>Trotzdem neu anlegen</button>
                </div>
              </div>
            </div>
          )}
          <div className="feld"><label>Name *</label><input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus /></div>
          <div className="feld-reihe">
            <div className="feld"><label>Telefon</label><input type="tel" value={form.telefon} onChange={(e) => set('telefon', e.target.value)} /></div>
            <div className="feld"><label>E-Mail</label><input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
          </div>
          <div className="feld"><label>Anliegen</label><textarea value={form.anliegen} onChange={(e) => set('anliegen', e.target.value)} rows={2} /></div>
          <div className="feld-reihe">
            <div className="feld"><label>Priorität</label><select value={form.prioritaet} onChange={(e) => set('prioritaet', e.target.value)}>{PRIORITAETEN.map((p) => <option key={p}>{p}</option>)}</select></div>
            <div className="feld"><label>Quelle</label><select value={form.quelle} onChange={(e) => set('quelle', e.target.value)}>{QUELLEN.map((q) => <option key={q}>{q}</option>)}</select></div>
          </div>
        </div>
        <div className="modal-fuss">
          <button className="abbrechen-btn" onClick={onClose}>Abbrechen</button>
          <button className="speichern-btn" onClick={absenden}>Anlegen</button>
        </div>
      </div>
    </div>
  );
}

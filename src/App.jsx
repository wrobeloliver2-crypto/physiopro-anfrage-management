import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, Phone, Mail, Clock, AlertTriangle, ChevronDown, ChevronUp,
  X, Trash2, Calendar, User, Globe, Check, RefreshCw, StickyNote,
  PhoneCall, Pin,
} from 'lucide-react';

// ====================================================================
// Konfiguration
// ====================================================================
const BACKEND_BASE =
  import.meta.env.VITE_BACKEND_BASE || 'https://leadmanagementphysiopro.netlify.app';
const API_URL = BACKEND_BASE + '/.netlify/functions/sheets-api';
const NOTES_URL = BACKEND_BASE + '/.netlify/functions/notes-api';

const SPALTEN = ['Offen', 'In Bearbeitung', 'To Do'];
const ALLE_STATUS = ['Offen', 'In Bearbeitung', 'To Do', 'Erledigt'];
const PRIORITAETEN = ['Sofort', 'Normal', 'Niedrig'];
const BEARBEITER = ['Luca', 'Finn', 'Annika', 'Oliver Wrobel', 'Hanna Wrobel', 'Unzugewiesen'];
const QUELLEN = ['Website', 'Telefon-Benachrichtigung', 'Manuell erfasst'];
const READ_ONLY_USERS = ['Oliver Wrobel', 'Hanna Wrobel'];

// Uhrzeit-Slots 08:00–18:00 in 30-Min-Schritten
const ZEIT_SLOTS = (() => {
  const slots = [];
  for (let h = 8; h <= 18; h++) {
    slots.push(String(h).padStart(2, '0') + ':00');
    if (h < 18) slots.push(String(h).padStart(2, '0') + ':30');
  }
  return slots;
})();

const SPALTEN_AKZENT = {
  'Offen': '#55725e',
  'In Bearbeitung': '#8c7660',
  'To Do': '#b8742a',
};
const PRIO_STYLE = {
  Sofort: { rand: '#c0392b', text: '#c0392b', bg: '#fbeae8', label: 'Sofort' },
  Normal: { rand: '#55725e', text: '#3d5445', bg: '#eef3f0', label: 'Normal' },
  Niedrig: { rand: '#c4b09a', text: '#8c7660', bg: '#f7f0e8', label: 'Niedrig' },
};

// ====================================================================
// Hilfsfunktionen
// ====================================================================
const heute = () => new Date().toISOString().slice(0, 10);
const jetztISO = () => new Date().toISOString();
const neueId = () => 'temp-' + Date.now();
const uhrzeit = (iso) => {
  try { return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
};
function historyEintrag(aktion, von, details) {
  return { zeitstempel: jetztISO(), aktion, von, details };
}
function followupFaellig(a) {
  if (!a.followupDatum) return false;
  const ziel = a.followupDatum + (a.followupZeit ? 'T' + a.followupZeit : 'T23:59');
  return new Date(ziel) < new Date() && a.status !== 'Erledigt';
}
const istHeute = (d) => d === heute();

// ====================================================================
// Haupt-Komponente
// ====================================================================
export default function App() {
  const [anfragen, setAnfragen] = useState([]);
  const [notizen, setNotizen] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(
    () => localStorage.getItem('currentUser') || 'Luca'
  );
  const [showNewForm, setShowNewForm] = useState(false);
  const [selectedAnfrage, setSelectedAnfrage] = useState(null);
  const [error, setError] = useState(null);
  const [letzteAenderung, setLetzteAenderung] = useState(null);

  const isReadOnly = READ_ONLY_USERS.includes(currentUser);

  useEffect(() => { loadFromSheets(); loadNotes(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { localStorage.setItem('currentUser', currentUser); }, [currentUser]);
  useEffect(() => {
    const t = setInterval(() => { loadFromSheets(); loadNotes(); }, 60000);
    return () => clearInterval(t); /* eslint-disable-next-line */
  }, []);

  const loadFromSheets = useCallback(async (versuch = 0) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(API_URL, { method: 'GET' });
      if (res.status === 403) throw new Error('Keine Berechtigung fuer Google Sheet');
      if (res.status === 429) throw new Error('Zu viele Anfragen. Bitte warten...');
      if (!res.ok) throw new Error('Verbindung fehlgeschlagen');
      const json = await res.json();
      const data = Array.isArray(json.data) ? json.data : [];
      const migriert = data.map((a) => {
        let s = a.status;
        if (s === 'Neu') s = 'Offen';
        else if (s === 'Angeboten') s = 'In Bearbeitung';
        return { ...a, status: s };
      });
      setAnfragen(migriert);
      setLetzteAenderung(new Date());
    } catch (e) {
      if (versuch < 2) { setTimeout(() => loadFromSheets(versuch + 1), 3000); return; }
      setError(e.message || 'Verbindung fehlgeschlagen');
    } finally { setLoading(false); }
  }, []);

  const loadNotes = useCallback(async () => {
    try {
      const res = await fetch(NOTES_URL, { method: 'GET' });
      if (!res.ok) return;
      const json = await res.json();
      setNotizen(Array.isArray(json.data) ? json.data : []);
    } catch { /* optional */ }
  }, []);

  const saveToSheets = useCallback(async (data) => {
    try {
      const res = await fetch(API_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anfragen: data }),
      });
      if (!res.ok) throw new Error('Speichern fehlgeschlagen');
      setLetzteAenderung(new Date());
    } catch { setError('Verbindung fehlgeschlagen - Aenderung evtl. nicht gespeichert'); }
  }, []);
  const persist = (data) => { setAnfragen(data); saveToSheets(data); };

  const saveNotes = useCallback(async (data) => {
    try {
      await fetch(NOTES_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notizen: data }),
      });
      setLetzteAenderung(new Date());
    } catch { setError('Notiz konnte evtl. nicht gespeichert werden'); }
  }, []);
  const persistNotes = (data) => { setNotizen(data); saveNotes(data); };

  const checkDuplicate = (name, telefon) =>
    anfragen.find((a) => a.name.toLowerCase() === name.toLowerCase() &&
      a.telefon === telefon && a.status !== 'Erledigt');

  const addAnfrage = (data) => {
    const neu = {
      id: neueId(), eingangsdatum: heute(), quelle: data.quelle,
      name: data.name, telefon: data.telefon, email: data.email || '',
      anliegen: data.anliegen, prioritaet: data.prioritaet, status: 'Offen',
      bearbeiter: 'Unzugewiesen', followupDatum: '', followupZeit: '',
      notizen: '', history: [historyEintrag('Erstellt', currentUser, 'Manuell erfasst')],
      reminderStatus: '',
    };
    persist([...anfragen, neu]); setShowNewForm(false);
  };
  const mergeAnfrage = (bestehend, data) => {
    const updated = anfragen.map((a) => a.id === bestehend.id
      ? { ...a, anliegen: a.anliegen + ' | ' + data.anliegen,
          history: [...a.history, historyEintrag('Aktualisiert', currentUser, 'Erneute Anfrage zusammengefuehrt')] }
      : a);
    persist(updated); setShowNewForm(false);
  };
  const updateAnfrage = (updated, beschreibung = 'Aktualisiert') => {
    const data = anfragen.map((a) => a.id === updated.id
      ? { ...updated, history: [...(updated.history || []), historyEintrag('Aktualisiert', currentUser, beschreibung)] }
      : a);
    persist(data); setSelectedAnfrage(null);
  };
  const changeStatus = (anfrage, neuerStatus) => {
    const data = anfragen.map((a) => a.id === anfrage.id
      ? { ...a, status: neuerStatus,
          history: [...a.history, historyEintrag('Status geaendert', currentUser, anfrage.status + ' -> ' + neuerStatus)] }
      : a);
    persist(data);
    setSelectedAnfrage((prev) => (prev ? { ...prev, status: neuerStatus } : prev));
  };
  const deleteAnfrage = (anfrage) => {
    if (!window.confirm('Anfrage von ' + anfrage.name + ' wirklich loeschen?')) return;
    persist(anfragen.filter((a) => a.id !== anfrage.id)); setSelectedAnfrage(null);
  };
  const addNotiz = (text) => {
    if (!text.trim()) return;
    persistNotes([...notizen, { id: neueId(), text: text.trim(), autor: currentUser, zeit: jetztISO() }]);
  };
  const deleteNotiz = (id) => persistNotes(notizen.filter((n) => n.id !== id));

  const offeneCount = anfragen.filter((a) => a.status === 'Offen').length;
  const sofortCount = anfragen.filter((a) => a.status !== 'Erledigt' && a.prioritaet === 'Sofort').length;
  const erledigtHeute = useMemo(
    () => anfragen.filter((a) => a.status === 'Erledigt' && istHeute(a.eingangsdatum)).length,
    [anfragen]
  );

  return (
    <div className="app-shell">
      <div className="panel">
        <Titlebar />
        <Kopfzeile
          offeneCount={offeneCount} sofortCount={sofortCount} erledigtHeute={erledigtHeute}
          letzteAenderung={letzteAenderung} currentUser={currentUser}
          setCurrentUser={setCurrentUser} isReadOnly={isReadOnly}
          onNeu={() => setShowNewForm(true)}
        />
        {error && (
          <div className="fehler-leiste">
            <span>{error}</span>
            <button onClick={() => loadFromSheets()}>Erneut versuchen</button>
          </div>
        )}
        <main className="board-bereich">
          {loading && anfragen.length === 0 ? (
            <div className="lade-zustand"><div className="spinner" /><span>Daten laden…</span></div>
          ) : (
            <div className="spalten-grid">
              {SPALTEN.map((status) => (
                <StatusSpalte key={status} status={status}
                  anfragen={anfragen.filter((a) => a.status === status)}
                  onCardClick={setSelectedAnfrage} />
              ))}
            </div>
          )}
          <UebergabeNotizen notizen={notizen} isReadOnly={isReadOnly}
            onAdd={addNotiz} onDelete={deleteNotiz} />
        </main>
        {selectedAnfrage && (
          <AnfragenModal anfrage={selectedAnfrage} isReadOnly={isReadOnly}
            onClose={() => setSelectedAnfrage(null)} onSave={updateAnfrage}
            onStatusChange={changeStatus} onDelete={deleteAnfrage} />
        )}
        {showNewForm && !isReadOnly && (
          <NeueAnfrageForm onClose={() => setShowNewForm(false)} onSubmit={addAnfrage}
            onMerge={mergeAnfrage} checkDuplicate={checkDuplicate} />
        )}
      </div>
    </div>
  );
}

// ====================================================================
// Titlebar
// ====================================================================
function Titlebar() {
  const [pinned, setPinned] = useState(true);
  const togglePin = async () => {
    const next = !pinned; setPinned(next);
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().setAlwaysOnTop(next);
    } catch { /* Browser */ }
  };
  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-left" data-tauri-drag-region>
        <span className="ampel" />
        <span className="titlebar-text">PhysioPro Rezeption</span>
      </div>
      <div className="titlebar-right">
        <button className={'pin-btn' + (pinned ? ' pin-aktiv' : '')} onClick={togglePin}
          title={pinned ? 'Immer im Vordergrund: AN' : 'Immer im Vordergrund: AUS'}
          aria-label="Immer im Vordergrund umschalten">
          <Pin size={14} />
        </button>
      </div>
    </div>
  );
}

// ====================================================================
// Kopfzeile
// ====================================================================
function Kopfzeile({ offeneCount, sofortCount, erledigtHeute, letzteAenderung,
  currentUser, setCurrentUser, isReadOnly, onNeu }) {
  const aenderungsZeit = letzteAenderung
    ? letzteAenderung.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : '—';
  return (
    <div className="kopfzeile">
      <div className="kopf-links">
        <div>
          <h1 className="kopf-titel">Rezeptionsdashboard</h1>
          <div className="kopf-zeitstempel">
            <RefreshCw size={10} /> Letzte Änderung {aenderungsZeit}
          </div>
        </div>
        <div className="erledigt-chip">
          <Check size={13} />
          <span>{erledigtHeute} heute erledigt</span>
        </div>
      </div>
      <div className="kopf-rechts">
        <span className="kopf-stats">{offeneCount} offen{sofortCount > 0 ? ' · ' + sofortCount + ' sofort' : ''}</span>
        <select className="user-select" aria-label="Benutzer auswaehlen"
          value={currentUser} onChange={(e) => setCurrentUser(e.target.value)}>
          {BEARBEITER.filter((b) => b !== 'Unzugewiesen').map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        {!isReadOnly && (
          <button className="neu-btn" onClick={onNeu}>
            <Plus size={14} /> Eintrag
          </button>
        )}
      </div>
    </div>
  );
}

// ====================================================================
// StatusSpalte
// ====================================================================
function StatusSpalte({ status, anfragen, onCardClick }) {
  const akzent = SPALTEN_AKZENT[status];
  const istTodo = status === 'To Do';
  return (
    <section className="spalte">
      <div className="spalte-kopf">
        <span className="spalte-titel" style={{ color: akzent }}>{status}</span>
        <span className="spalte-zaehler" style={{
          background: istTodo || status === 'Offen' ? akzent : '#f2ede6',
          color: istTodo || status === 'Offen' ? '#fff' : '#8c7660',
        }}>{anfragen.length}</span>
      </div>
      <div className="spalte-karten">
        {anfragen.map((a) => (
          <AnfragenKarte key={a.id} anfrage={a} istTodo={istTodo} onClick={() => onCardClick(a)} />
        ))}
        {anfragen.length === 0 && <p className="spalte-leer">Keine Einträge</p>}
      </div>
    </section>
  );
}

// ====================================================================
// AnfragenKarte
// ====================================================================
function AnfragenKarte({ anfrage, istTodo, onClick }) {
  const prio = PRIO_STYLE[anfrage.prioritaet] || PRIO_STYLE.Normal;
  const faellig = followupFaellig(anfrage);
  const quelleIcon = anfrage.quelle === 'Telefon-Benachrichtigung'
    ? <Phone size={11} /> : <Globe size={11} />;
  return (
    <button className={'karte' + (istTodo ? ' karte-todo' : '')} onClick={onClick}
      style={{ borderLeftColor: istTodo ? '#d99a3a' : prio.rand }}>
      <div className="karte-kopf">
        <span className="karte-name">{anfrage.name}</span>
        {istTodo ? (
          <AlertTriangle size={12} color="#b8742a" />
        ) : (
          <span className="karte-prio" style={{ color: prio.text, background: prio.bg }}>
            {prio.label}
          </span>
        )}
      </div>
      <p className="karte-anliegen">{anfrage.anliegen}</p>
      <div className="karte-meta">
        {anfrage.bearbeiter && anfrage.bearbeiter !== 'Unzugewiesen' ? (
          <span className="karte-meta-item"><User size={11} />{anfrage.bearbeiter}</span>
        ) : (
          <span className="karte-meta-item">{quelleIcon}{anfrage.quelle === 'Telefon-Benachrichtigung' ? 'Telefon' : anfrage.quelle === 'Website' ? 'Webformular' : 'Manuell'}</span>
        )}
      </div>
      {anfrage.followupDatum && (
        <div className={'karte-followup' + (faellig ? ' faellig' : '')}>
          <Clock size={11} />
          {faellig ? 'Fällig: ' : 'Termin: '}{anfrage.followupDatum} {anfrage.followupZeit}
        </div>
      )}
    </button>
  );
}

// ====================================================================
// UebergabeNotizen
// ====================================================================
function UebergabeNotizen({ notizen, isReadOnly, onAdd, onDelete }) {
  const [text, setText] = useState('');
  const absenden = () => { if (text.trim()) { onAdd(text); setText(''); } };
  return (
    <div className="notizen-box">
      <div className="notizen-kopf">
        <span className="notizen-titel"><StickyNote size={15} /> Übergabe-Notizen</span>
        <span className="notizen-sub">für die nächste Schicht</span>
      </div>
      <div className="notizen-liste">
        {notizen.length === 0 && <p className="notizen-leer">Noch keine Notizen für die Übergabe.</p>}
        {notizen.map((n) => (
          <div className="notiz" key={n.id}>
            <span className="notiz-punkt" />
            <div className="notiz-inhalt">
              <div className="notiz-text">{n.text}</div>
              <div className="notiz-meta">{uhrzeit(n.zeit)} · {n.autor}</div>
            </div>
            {!isReadOnly && (
              <button className="notiz-loeschen" onClick={() => onDelete(n.id)} aria-label="Notiz loeschen">
                <X size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
      {!isReadOnly && (
        <div className="notiz-neu">
          <input type="text" value={text} placeholder="Notiz für die nächste Schicht hinzufügen …"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') absenden(); }} />
          <button onClick={absenden} disabled={!text.trim()}><Plus size={14} /></button>
        </div>
      )}
    </div>
  );
}

// ====================================================================
// AnfragenModal (Detail / Edit)
// ====================================================================
function AnfragenModal({ anfrage, isReadOnly, onClose, onSave, onStatusChange, onDelete }) {
  const [form, setForm] = useState({ ...anfrage });
  const [showHistory, setShowHistory] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-kopf">
          <h2>{anfrage.name}</h2>
          <button onClick={onClose} aria-label="Schliessen"><X size={20} /></button>
        </div>
        <div className="modal-body">
          <div className="info-grid">
            <InfoCard icon={<Calendar size={14} />} label="Eingang" value={anfrage.eingangsdatum} />
            <InfoCard icon={<Phone size={14} />} label="Telefon" value={anfrage.telefon || '-'} />
            <InfoCard icon={<Mail size={14} />} label="E-Mail" value={anfrage.email || '-'} />
            <InfoCard icon={<Globe size={14} />} label="Quelle" value={anfrage.quelle} />
          </div>

          <div className="feld">
            <label>Anliegen</label>
            {isReadOnly ? <p className="feld-wert">{anfrage.anliegen}</p>
              : <textarea value={form.anliegen} onChange={(e) => set('anliegen', e.target.value)} rows={2} />}
          </div>

          <div className="feld-reihe">
            <div className="feld">
              <label>Status</label>
              {isReadOnly ? <p className="feld-wert">{anfrage.status}</p> : (
                <div className="status-buttons">
                  {ALLE_STATUS.map((s) => (
                    <button key={s} className={'status-btn' + (anfrage.status === s ? ' aktiv' : '')}
                      onClick={() => onStatusChange(anfrage, s)}>{s}</button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="feld-reihe">
            <div className="feld">
              <label>Priorität</label>
              {isReadOnly ? <p className="feld-wert">{anfrage.prioritaet}</p> : (
                <select value={form.prioritaet} onChange={(e) => set('prioritaet', e.target.value)}>
                  {PRIORITAETEN.map((p) => <option key={p}>{p}</option>)}
                </select>
              )}
            </div>
            <div className="feld">
              <label>Bearbeiter</label>
              {isReadOnly ? <p className="feld-wert">{anfrage.bearbeiter}</p> : (
                <select value={form.bearbeiter} onChange={(e) => set('bearbeiter', e.target.value)}>
                  {BEARBEITER.map((b) => <option key={b}>{b}</option>)}
                </select>
              )}
            </div>
          </div>

          <div className="feld-reihe">
            <div className="feld">
              <label>Follow-up Datum</label>
              {isReadOnly ? <p className="feld-wert">{anfrage.followupDatum || '-'}</p> : (
                <input type="date" value={form.followupDatum || ''} onChange={(e) => set('followupDatum', e.target.value)} />
              )}
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
            {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            Änderungs-History ({(anfrage.history || []).length})
          </button>
          {showHistory && (
            <div className="history-liste">
              {(anfrage.history || []).slice().reverse().map((h, i) => (
                <div className="history-eintrag" key={i}>
                  <span className="history-zeit">{uhrzeit(h.zeitstempel)}</span>
                  <span className="history-text"><strong>{h.aktion}</strong> · {h.von}{h.details ? ' · ' + h.details : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {!isReadOnly && (
          <div className="modal-fuss">
            <button className="loeschen-btn" onClick={() => onDelete(anfrage)}>
              <Trash2 size={14} /> Löschen
            </button>
            <button className="speichern-btn" onClick={() => onSave(form)}>Speichern</button>
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
  const [form, setForm] = useState({
    name: '', telefon: '', email: '', anliegen: '',
    prioritaet: 'Normal', quelle: 'Manuell erfasst',
  });
  const [duplikat, setDuplikat] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

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
          <h2>Neuer Eintrag</h2>
          <button onClick={onClose} aria-label="Schliessen"><X size={20} /></button>
        </div>
        <div className="modal-body">
          {duplikat && (
            <div className="duplikat-warnung">
              <AlertTriangle size={16} />
              <div>
                <strong>Mögliches Duplikat:</strong> {duplikat.name} ({duplikat.telefon}) existiert bereits.
                <div className="duplikat-aktionen">
                  <button onClick={() => onMerge(duplikat, form)}>Zusammenführen</button>
                  <button onClick={() => onSubmit(form)}>Trotzdem neu anlegen</button>
                </div>
              </div>
            </div>
          )}
          <div className="feld">
            <label>Name *</label>
            <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
          </div>
          <div className="feld-reihe">
            <div className="feld">
              <label>Telefon</label>
              <input type="tel" value={form.telefon} onChange={(e) => set('telefon', e.target.value)} />
            </div>
            <div className="feld">
              <label>E-Mail</label>
              <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </div>
          </div>
          <div className="feld">
            <label>Anliegen</label>
            <textarea value={form.anliegen} onChange={(e) => set('anliegen', e.target.value)} rows={2} />
          </div>
          <div className="feld-reihe">
            <div className="feld">
              <label>Priorität</label>
              <select value={form.prioritaet} onChange={(e) => set('prioritaet', e.target.value)}>
                {PRIORITAETEN.map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div className="feld">
              <label>Quelle</label>
              <select value={form.quelle} onChange={(e) => set('quelle', e.target.value)}>
                {QUELLEN.map((q) => <option key={q}>{q}</option>)}
              </select>
            </div>
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

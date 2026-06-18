import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Phone,
  Mail,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  X,
  Trash2,
  Edit3,
  Calendar,
  User,
} from 'lucide-react';

// ====================================================================
// Konstanten / Konfiguration
// ====================================================================
const API_URL = '/.netlify/functions/sheets-api';

const STATUS = ['Neu', 'Angeboten', 'In Bearbeitung', 'Erledigt'];
const PRIORITAETEN = ['Sofort', 'Normal', 'Spaeter'];
const BEARBEITER = [
  'Luca',
  'Finn',
  'Annika',
  'Oliver Wrobel',
  'Hanna Wrobel',
  'Unzugewiesen',
];
const QUELLEN = ['Website', 'Telefon-Benachrichtigung', 'Manuell erfasst'];

// Read-only Benutzer (Leads) - duerfen nur lesen
const READ_ONLY_USERS = ['Oliver Wrobel', 'Hanna Wrobel'];

const STATUS_FARBEN = {
  Neu: 'bg-blue-100 text-blue-800 border-blue-200',
  Angeboten: 'bg-amber-100 text-amber-800 border-amber-200',
  'In Bearbeitung': 'bg-purple-100 text-purple-800 border-purple-200',
  Erledigt: 'bg-green-100 text-green-800 border-green-200',
};

// ====================================================================
// Hilfsfunktionen
// ====================================================================
const heute = () => new Date().toISOString().slice(0, 10);
const jetztISO = () => new Date().toISOString();

function neueId() {
  return 'temp-' + Date.now();
}

// History-Eintrag erstellen
function historyEintrag(aktion, von, details) {
  return { zeitstempel: jetztISO(), aktion, von, details };
}

// Linearer Status-Flow: nur naechster Schritt erlaubt (oder zurueck zu Neu)
function naechsterErlaubt(aktuell, ziel) {
  const i = STATUS.indexOf(aktuell);
  const j = STATUS.indexOf(ziel);
  if (j === i) return false;
  return j === i + 1; // nur ein Schritt vorwaerts
}

// Follow-up faellig?
function followupFaellig(a) {
  if (!a.followupDatum) return false;
  const ziel = a.followupDatum + (a.followupZeit ? 'T' + a.followupZeit : 'T23:59');
  return new Date(ziel) < new Date() && a.status !== 'Erledigt';
}

// ====================================================================
// Haupt-Komponente
// ====================================================================
export default function App() {
  const [anfragen, setAnfragen] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(
    () => localStorage.getItem('currentUser') || 'Luca'
  );
  const [showNewForm, setShowNewForm] = useState(false);
  const [selectedAnfrage, setSelectedAnfrage] = useState(null);
  const [error, setError] = useState(null);

  const isReadOnly = READ_ONLY_USERS.includes(currentUser);

  // ---- Startup: Daten laden ----
  useEffect(() => {
    loadFromSheets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- currentUser persistieren ----
  useEffect(() => {
    localStorage.setItem('currentUser', currentUser);
  }, [currentUser]);

  // ---- Laden mit Retry ----
  const loadFromSheets = useCallback(async (versuch = 0) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(API_URL, { method: 'GET' });
      if (res.status === 403) throw new Error('Keine Berechtigung fuer Google Sheet');
      if (res.status === 429) throw new Error('Zu viele Anfragen. Bitte warten...');
      if (!res.ok) throw new Error('Verbindung fehlgeschlagen');
      const json = await res.json();
      setAnfragen(Array.isArray(json.data) ? json.data : []);
    } catch (e) {
      if (versuch < 2) {
        setTimeout(() => loadFromSheets(versuch + 1), 3000);
        return;
      }
      setError(e.message || 'Verbindung fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }, []);

  // ---- Speichern (Auto-Save) ----
  const saveToSheets = useCallback(async (data) => {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anfragen: data }),
      });
      if (!res.ok) throw new Error('Speichern fehlgeschlagen');
    } catch (e) {
      setError('Verbindung fehlgeschlagen - Aenderung evtl. nicht gespeichert');
    }
  }, []);

  // Persistiert eine neue Liste und aktualisiert den State
  const persist = (data) => {
    setAnfragen(data);
    saveToSheets(data);
  };

  // ---- Duplikat-Pruefung ----
  const checkDuplicate = (name, telefon) =>
    anfragen.find(
      (a) =>
        a.name.toLowerCase() === name.toLowerCase() &&
        a.telefon === telefon &&
        a.status !== 'Erledigt'
    );

  // ---- Neue Anfrage ----
  const addAnfrage = (data) => {
    const neu = {
      id: neueId(),
      eingangsdatum: heute(),
      quelle: data.quelle,
      name: data.name,
      telefon: data.telefon,
      email: data.email || '',
      anliegen: data.anliegen,
      prioritaet: data.prioritaet,
      status: 'Neu',
      bearbeiter: 'Unzugewiesen',
      followupDatum: '',
      followupZeit: '',
      notizen: '',
      history: [historyEintrag('Erstellt', currentUser, 'Manuell erfasst')],
      reminderStatus: '',
    };
    persist([...anfragen, neu]);
    setShowNewForm(false);
  };

  // ---- Merge in bestehende Anfrage ----
  const mergeAnfrage = (bestehend, data) => {
    const updated = anfragen.map((a) =>
      a.id === bestehend.id
        ? {
            ...a,
            anliegen: a.anliegen + ' | ' + data.anliegen,
            history: [
              ...a.history,
              historyEintrag('Aktualisiert', currentUser, 'Erneute Anfrage zusammengefuehrt'),
            ],
          }
        : a
    );
    persist(updated);
    setShowNewForm(false);
  };

  // ---- Anfrage aktualisieren ----
  const updateAnfrage = (updated, beschreibung = 'Aktualisiert') => {
    const data = anfragen.map((a) =>
      a.id === updated.id
        ? {
            ...updated,
            history: [
              ...(updated.history || []),
              historyEintrag('Aktualisiert', currentUser, beschreibung),
            ],
          }
        : a
    );
    persist(data);
    setSelectedAnfrage(null);
  };

  // ---- Status wechseln (linearer Flow) ----
  const changeStatus = (anfrage, neuerStatus) => {
    if (!naechsterErlaubt(anfrage.status, neuerStatus)) {
      alert('Statuswechsel nur in dieser Reihenfolge: Neu -> Angeboten -> In Bearbeitung -> Erledigt');
      return;
    }
    const data = anfragen.map((a) =>
      a.id === anfrage.id
        ? {
            ...a,
            status: neuerStatus,
            history: [
              ...a.history,
              historyEintrag('Status geaendert', currentUser, anfrage.status + ' -> ' + neuerStatus),
            ],
          }
        : a
    );
    persist(data);
    setSelectedAnfrage((prev) => (prev ? { ...prev, status: neuerStatus } : prev));
  };

  // ---- Loeschen ----
  const deleteAnfrage = (anfrage) => {
    if (!window.confirm('Anfrage von ' + anfrage.name + ' wirklich loeschen?')) return;
    persist(anfragen.filter((a) => a.id !== anfrage.id));
    setSelectedAnfrage(null);
  };

  // ================================================================
  // Render
  // ================================================================
  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-physiopro text-white shadow">
        <div className="max-w-screen-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">PhysioPro Anfrage-Management</h1>
            <p className="text-sm text-green-100">Rezeption Luebeck - Dashboard</p>
          </div>
          <div className="flex items-center gap-3">
            <label className="sr-only" htmlFor="user-select">Benutzer</label>
            <select
              id="user-select"
              aria-label="Benutzer auswaehlen"
              value={currentUser}
              onChange={(e) => setCurrentUser(e.target.value)}
              className="text-gray-800 rounded px-2 py-1 text-sm"
            >
              {BEARBEITER.filter((b) => b !== 'Unzugewiesen').map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
            {!isReadOnly && (
              <button
                onClick={() => setShowNewForm(true)}
                className="bg-white text-physiopro font-medium rounded px-3 py-1.5 text-sm flex items-center gap-1 hover:bg-green-50"
              >
                <Plus size={16} /> Neue Anfrage
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Error Toast */}
      {error && (
        <div className="max-w-screen-2xl mx-auto px-4 mt-3">
          <div className="bg-red-100 border border-red-300 text-red-800 rounded px-4 py-2 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => loadFromSheets()} className="underline">Erneut versuchen</button>
          </div>
        </div>
      )}

      {/* Board */}
      <main className="max-w-screen-2xl mx-auto px-4 py-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-500">
            <div className="animate-spin h-8 w-8 border-4 border-physiopro border-t-transparent rounded-full mb-3" />
            <span>Daten laden...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {STATUS.map((status) => (
              <StatusColumn
                key={status}
                status={status}
                anfragen={anfragen.filter((a) => a.status === status)}
                onCardClick={setSelectedAnfrage}
              />
            ))}
          </div>
        )}
      </main>

      {/* Modals */}
      {selectedAnfrage && (
        <AnfragenModal
          anfrage={selectedAnfrage}
          isReadOnly={isReadOnly}
          onClose={() => setSelectedAnfrage(null)}
          onSave={updateAnfrage}
          onStatusChange={changeStatus}
          onDelete={deleteAnfrage}
        />
      )}
      {showNewForm && !isReadOnly && (
        <NeueAnfrageForm
          onClose={() => setShowNewForm(false)}
          onSubmit={addAnfrage}
          onMerge={mergeAnfrage}
          checkDuplicate={checkDuplicate}
        />
      )}
    </div>
  );
}

// ====================================================================
// StatusColumn
// ====================================================================
function StatusColumn({ status, anfragen, onCardClick }) {
  return (
    <section className="bg-gray-50 rounded-lg border border-gray-200 flex flex-col">
      <div className={'rounded-t-lg px-3 py-2 border-b font-semibold text-sm flex items-center justify-between ' + STATUS_FARBEN[status]}>
        <span>{status}</span>
        <span className="bg-white/70 rounded-full px-2 text-xs">{anfragen.length}</span>
      </div>
      <div className="p-2 space-y-2 min-h-[120px]">
        {anfragen.map((a) => (
          <AnfragenKarte key={a.id} anfrage={a} onClick={() => onCardClick(a)} />
        ))}
        {anfragen.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-4">Keine Anfragen</p>
        )}
      </div>
    </section>
  );
}

// ====================================================================
// AnfragenKarte
// ====================================================================
function AnfragenKarte({ anfrage, onClick }) {
  const isPriority = anfrage.prioritaet === 'Sofort';
  const faellig = followupFaellig(anfrage);
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white rounded-md border border-gray-200 p-3 shadow-sm hover:shadow transition"
    >
      <div className="flex items-start justify-between">
        <span className="font-medium text-gray-800">{anfrage.name}</span>
        {isPriority && (
          <span className="bg-red-100 text-red-700 text-xs rounded px-1.5 py-0.5 font-semibold">Sofort</span>
        )}
      </div>
      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{anfrage.anliegen}</p>
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
        {anfrage.telefon && (
          <span className="flex items-center gap-1"><Phone size={12} />{anfrage.telefon}</span>
        )}
        {anfrage.bearbeiter && anfrage.bearbeiter !== 'Unzugewiesen' && (
          <span className="flex items-center gap-1"><User size={12} />{anfrage.bearbeiter}</span>
        )}
      </div>
      {anfrage.followupDatum && (
        <div className={'mt-2 text-xs flex items-center gap-1 ' + (faellig ? 'text-orange-600 font-semibold' : 'text-gray-500')}>
          <Clock size={12} />
          {faellig ? 'Follow-up faellig! ' : 'Anruf: '}
          {anfrage.followupDatum} {anfrage.followupZeit}
        </div>
      )}
    </button>
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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="bg-physiopro text-white px-5 py-3 flex items-center justify-between sticky top-0">
          <h2 className="font-semibold">{anfrage.name}</h2>
          <button onClick={onClose} aria-label="Schliessen"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Info Cards */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <InfoCard icon={<Calendar size={14} />} label="Eingangsdatum" value={anfrage.eingangsdatum} />
            <InfoCard icon={<Phone size={14} />} label="Telefon" value={anfrage.telefon || '-'} />
            <InfoCard icon={<Mail size={14} />} label="Email" value={anfrage.email || '-'} />
            <InfoCard icon={<User size={14} />} label="Quelle" value={anfrage.quelle} />
          </div>

          <div>
            <span className="text-xs font-medium text-gray-500">Anliegen</span>
            <p className="text-sm text-gray-800">{anfrage.anliegen}</p>
          </div>

          {/* Editable Felder */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Prioritaet">
              <select disabled={isReadOnly} value={form.prioritaet}
                onChange={(e) => set('prioritaet', e.target.value)}
                className="w-full border rounded px-2 py-1 text-sm disabled:bg-gray-100">
                {PRIORITAETEN.map((p) => <option key={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Bearbeiter">
              <select disabled={isReadOnly} value={form.bearbeiter}
                onChange={(e) => set('bearbeiter', e.target.value)}
                className="w-full border rounded px-2 py-1 text-sm disabled:bg-gray-100">
                {BEARBEITER.map((b) => <option key={b}>{b}</option>)}
              </select>
            </Field>
            <Field label="Follow-up Datum">
              <input type="date" disabled={isReadOnly} value={form.followupDatum}
                onChange={(e) => set('followupDatum', e.target.value)}
                className="w-full border rounded px-2 py-1 text-sm disabled:bg-gray-100" />
            </Field>
            <Field label="Follow-up Zeit">
              <input type="time" disabled={isReadOnly} value={form.followupZeit}
                onChange={(e) => set('followupZeit', e.target.value)}
                className="w-full border rounded px-2 py-1 text-sm disabled:bg-gray-100" />
            </Field>
          </div>

          <Field label="Notizen (max 500 Zeichen)">
            <textarea disabled={isReadOnly} maxLength={500} rows={3} value={form.notizen}
              onChange={(e) => set('notizen', e.target.value)}
              className="w-full border rounded px-2 py-1 text-sm disabled:bg-gray-100" />
          </Field>

          {/* Status Buttons (linearer Flow) */}
          <div>
            <span className="text-xs font-medium text-gray-500">Status</span>
            <div className="flex flex-wrap gap-2 mt-1">
              {STATUS.map((s) => (
                <button key={s} disabled={isReadOnly || s === anfrage.status}
                  onClick={() => onStatusChange(anfrage, s)}
                  className={'text-xs rounded px-2 py-1 border ' +
                    (s === anfrage.status ? STATUS_FARBEN[s] + ' font-semibold' : 'bg-white text-gray-600 hover:bg-gray-50') +
                    ' disabled:opacity-50'}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* History */}
          <div className="border-t pt-3">
            <button onClick={() => setShowHistory((s) => !s)}
              className="flex items-center gap-1 text-sm font-medium text-gray-700">
              {showHistory ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              Aenderungs-History ({(anfrage.history || []).length})
            </button>
            {showHistory && (
              <ul className="mt-2 space-y-2 max-h-48 overflow-y-auto text-xs">
                {[...(anfrage.history || [])].reverse().map((h, i) => (
                  <li key={i} className="border-l-2 border-physiopro pl-2">
                    <span className="font-medium">
                      {new Date(h.zeitstempel).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} {h.aktion}
                    </span>
                    <span className="text-gray-500"> von {h.von} - {h.details}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Footer */}
        {!isReadOnly && (
          <div className="px-5 py-3 border-t flex items-center justify-between sticky bottom-0 bg-white">
            <button onClick={() => onDelete(anfrage)}
              className="text-red-600 text-sm flex items-center gap-1 hover:underline">
              <Trash2 size={14} /> Loeschen
            </button>
            <button onClick={() => onSave({ ...form })}
              className="bg-physiopro text-white text-sm rounded px-4 py-1.5 flex items-center gap-1">
              <Edit3 size={14} /> Speichern
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoCard({ icon, label, value }) {
  return (
    <div className="bg-gray-50 rounded border border-gray-200 px-3 py-2">
      <div className="flex items-center gap-1 text-xs text-gray-500">{icon}{label}</div>
      <div className="text-sm text-gray-800 truncate">{value}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-500">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

// ====================================================================
// NeueAnfrageForm
// ====================================================================
function NeueAnfrageForm({ onClose, onSubmit, onMerge, checkDuplicate }) {
  const [form, setForm] = useState({
    quelle: 'Manuell erfasst',
    name: '',
    telefon: '',
    email: '',
    anliegen: '',
    prioritaet: 'Normal',
  });
  const [duplikat, setDuplikat] = useState(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const valid = form.name.trim().length >= 2 && form.telefon.trim().length >= 3 && form.anliegen.trim().length >= 5;

  const handleSubmit = () => {
    if (!valid) return;
    const dup = checkDuplicate(form.name, form.telefon);
    if (dup) {
      setDuplikat(dup);
      return;
    }
    onSubmit(form);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white rounded-lg w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="bg-physiopro text-white px-5 py-3 flex items-center justify-between">
          <h2 className="font-semibold">Neue Anfrage erfassen</h2>
          <button onClick={onClose} aria-label="Schliessen"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-3">
          <Field label="Quelle">
            <select value={form.quelle} onChange={(e) => set('quelle', e.target.value)}
              className="w-full border rounded px-2 py-1 text-sm">
              {QUELLEN.map((q) => <option key={q}>{q}</option>)}
            </select>
          </Field>
          <Field label="Name *">
            <input value={form.name} onChange={(e) => set('name', e.target.value)}
              className="w-full border rounded px-2 py-1 text-sm" />
          </Field>
          <Field label="Telefon *">
            <input value={form.telefon} onChange={(e) => set('telefon', e.target.value)}
              className="w-full border rounded px-2 py-1 text-sm" />
          </Field>
          <Field label="Email">
            <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)}
              className="w-full border rounded px-2 py-1 text-sm" />
          </Field>
          <Field label="Anliegen *">
            <textarea rows={3} value={form.anliegen} onChange={(e) => set('anliegen', e.target.value)}
              className="w-full border rounded px-2 py-1 text-sm" />
          </Field>
          <Field label="Prioritaet">
            <select value={form.prioritaet} onChange={(e) => set('prioritaet', e.target.value)}
              className="w-full border rounded px-2 py-1 text-sm">
              {PRIORITAETEN.map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>

          {/* Duplikat-Warnung */}
          {duplikat && (
            <div className="bg-amber-50 border border-amber-300 rounded p-3 text-sm">
              <p className="flex items-center gap-1 text-amber-800 font-medium">
                <AlertTriangle size={16} /> Anfrage von {duplikat.name} ({duplikat.telefon}) existiert bereits!
              </p>
              <div className="flex gap-2 mt-2">
                <button onClick={() => onMerge(duplikat, form)}
                  className="bg-amber-600 text-white rounded px-3 py-1 text-xs">Mergen</button>
                <button onClick={() => setDuplikat(null)}
                  className="border rounded px-3 py-1 text-xs">Abbrechen</button>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t flex justify-end gap-2">
          <button onClick={onClose} className="border rounded px-4 py-1.5 text-sm">Abbrechen</button>
          <button onClick={handleSubmit} disabled={!valid}
            className="bg-physiopro text-white rounded px-4 py-1.5 text-sm disabled:opacity-50">
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useMemo, useCallback } from 'react';

// ====================================================================
// PhysioPro Osteopathie-Termine — als Tab in der To-Do-Spalte des
// Rezeptionsdashboards. Portiert aus der eigenständigen PWA
// (physiopro-osteo-termine), Logik unverändert, UI an React angepasst.
// ====================================================================

const BACKEND_BASE = import.meta.env.VITE_BACKEND_BASE || '';
const CREATE_URL = BACKEND_BASE + '/.netlify/functions/osteo-create-appointment';
const CANCEL_URL = BACKEND_BASE + '/.netlify/functions/osteo-cancel-appointment';
const LIST_URL = BACKEND_BASE + '/.netlify/functions/osteo-list-appointments';

const TYPES = [
  { key: 'osteo', title: 'Osteopathie', sub: '60 Minuten · 120 €' },
  { key: 'check', title: 'Osteopathie-Check', sub: '20 Minuten · 26,50 €' },
];
const PRACTITIONERS = ['Julia Mielke', 'Hanna Wrobel'];

const esc = (s) => (s || '').toString();

function val(s) { return (s || '').trim(); }

function validate(d) {
  if (!d.type) return 'Bitte zuerst die Terminart wählen.';
  if (!d.firstName || !d.lastName) return 'Bitte Vor- und Nachname angeben.';
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(d.email)) return 'Bitte gültige E-Mail angeben.';
  if (!d.date || !d.time) return 'Bitte Datum und Uhrzeit angeben.';
  const dt = new Date(d.date + 'T' + d.time);
  if (dt < new Date()) return 'Der Termin liegt in der Vergangenheit.';
  return null;
}

function uniquePatients(appts) {
  const sorted = [...appts].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const seen = new Map();
  for (const a of sorted) {
    const key = ((a.firstName || '') + '|' + (a.lastName || '') + '|' + (a.email || '')).toLowerCase().trim();
    if (key === '||') continue;
    if (!seen.has(key)) seen.set(key, a);
  }
  return [...seen.values()];
}

function patSearch(appts, q) {
  const term = q.toLowerCase().trim();
  const digits = q.replace(/\D/g, '');
  if (term.length < 2 && digits.length < 3) return [];
  return uniquePatients(appts).filter((p) => {
    const name = ((p.firstName || '') + ' ' + (p.lastName || '')).toLowerCase();
    const phone = String(p.phone || '').replace(/\D/g, '');
    const nameHit = term.length >= 2 && name.includes(term);
    const phoneHit = digits.length >= 3 && phone.includes(digits);
    return nameHit || phoneHit;
  }).slice(0, 8);
}

// ====================================================================
// Hauptkomponente
// ====================================================================
export default function OsteoTermine({ isReadOnly }) {
  const [innerTab, setInnerTab] = useState('list'); // 'list' | 'new'
  const [appts, setAppts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadList = useCallback(async () => {
    setError('');
    try {
      const r = await fetch(LIST_URL);
      const d = await r.json();
      if (!r.ok) { setError('Konnte Termine nicht laden.'); return; }
      setAppts(d.appointments || []);
    } catch {
      setError('Verbindungsfehler.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  const active = useMemo(
    () => appts.filter((a) => (a.status || 'active') !== 'cancelled' && new Date(a.date + 'T' + a.time) >= new Date()),
    [appts]
  );
  const cancelledCount = useMemo(() => appts.filter((a) => a.status === 'cancelled').length, [appts]);
  const upcoming = useMemo(
    () => [...active].sort((a, b) => new Date(a.date + 'T' + a.time) - new Date(b.date + 'T' + b.time)),
    [active]
  );

  return (
    <div className="osteo-wrap">
      <div className="osteo-tiles">
        <div className="osteo-tile"><div className="osteo-tile-n">{active.length}</div><div className="osteo-tile-l">anstehend</div></div>
        <div className="osteo-tile"><div className="osteo-tile-n">{cancelledCount}</div><div className="osteo-tile-l">abgesagt</div></div>
      </div>

      <div className="osteo-innertabs">
        <button className={'osteo-innertab' + (innerTab === 'list' ? ' aktiv' : '')} onClick={() => setInnerTab('list')}>Termine</button>
        {!isReadOnly && (
          <button className={'osteo-innertab' + (innerTab === 'new' ? ' aktiv' : '')} onClick={() => setInnerTab('new')}>Neuer Termin</button>
        )}
      </div>

      {error && <div className="osteo-msg osteo-msg-err">{error}</div>}

      {innerTab === 'list' ? (
        <OsteoListe appts={upcoming} loading={loading} isReadOnly={isReadOnly}
          onCancelled={loadList} />
      ) : (
        <OsteoNeuerTermin allAppts={appts} onCreated={() => { loadList(); setInnerTab('list'); }} />
      )}
    </div>
  );
}

// ====================================================================
// Terminliste
// ====================================================================
function OsteoListe({ appts, loading, isReadOnly, onCancelled }) {
  const [cancelTarget, setCancelTarget] = useState(null); // {id, name, date, time, free}
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const [toast, setToast] = useState('');
  const [expanded, setExpanded] = useState(false); // nur erste 2 Termine, Rest aufklappbar

  const VORSCHAU = 2;

  if (loading) return <div className="osteo-empty">Wird geladen…</div>;
  if (!appts.length) return <div className="osteo-empty">Keine anstehenden Termine.</div>;

  const askCancel = (a) => {
    const dt = new Date(a.date + 'T' + a.time);
    const hoursUntil = (dt - new Date()) / 3600000;
    setCancelError('');
    setCancelTarget({
      id: a.id, name: (a.firstName + ' ' + a.lastName).trim(),
      date: a.date, time: a.time, free: hoursUntil >= 24,
    });
  };

  const doCancel = async () => {
    if (!cancelTarget) return;
    setCancelBusy(true);
    setCancelError('');
    try {
      const r = await fetch(CANCEL_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: cancelTarget.id }),
      });
      const d = await r.json();
      if (r.ok) {
        setCancelTarget(null);
        setToast('Absage gesendet');
        setTimeout(() => setToast(''), 2500);
        onCancelled();
      } else {
        setCancelError(d.error || 'Absage fehlgeschlagen.');
      }
    } catch {
      setCancelError('Verbindungsfehler bei der Absage.');
    } finally {
      setCancelBusy(false);
    }
  };

  const sichtbar = expanded ? appts : appts.slice(0, VORSCHAU);
  const versteckt = appts.length - VORSCHAU;

  const renderAppt = (a) => {
    const dt = new Date(a.date + 'T' + a.time);
    const when = dt.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }) + ' · ' + a.time;
    const hoursUntil = (dt - new Date()) / 3600000;
    const free = hoursUntil >= 24;
    return (
      <div className="osteo-appt" key={a.id}>
        <div className="osteo-appt-top">
          <span className="osteo-appt-name">{esc(a.firstName)} {esc(a.lastName)}</span>
          <span className="osteo-appt-when">{when}</span>
        </div>
        <div className="osteo-appt-meta">
          {esc(a.practitioner || '')} · {a.type === 'check' ? 'Osteo-Check (20 Min)' : 'Osteopathie (60 Min)'} · {esc(a.email)}
        </div>
        <div className="osteo-badges">
          <span className={'osteo-badge' + (a.confirmSent ? ' done' : '')}>{a.confirmSent ? '✓ ' : ''}Bestätigung</span>
          <span className={'osteo-badge' + (a.reminder3dSent ? ' done' : '')}>{a.reminder3dSent ? '✓ ' : ''}Erinnerung 3 T.</span>
          <span className={'osteo-badge' + (a.reminder24hSent ? ' done' : '')}>{a.reminder24hSent ? '✓ ' : ''}Erinnerung 24 h</span>
        </div>
        {!isReadOnly && (
          <div className="osteo-appt-actions">
            <button className="osteo-ghost-btn" onClick={() => askCancel(a)}>Termin absagen</button>
            <span className="osteo-fee-hint" style={{ color: free ? 'var(--gruen)' : 'var(--bernstein)' }}>
              {free ? 'Absage derzeit kostenfrei' : 'Kurzfristig – Ausfallhonorar-Prüfung'}
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="osteo-card">
      <h3 className="osteo-card-h">Anstehende Termine</h3>
      <div className="osteo-list">
        {sichtbar.map(renderAppt)}
      </div>

      {appts.length > VORSCHAU && (
        <button className="osteo-ghost-btn osteo-mehr-btn" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Weniger anzeigen' : `+ ${versteckt} weitere ${versteckt === 1 ? 'Termin' : 'Termine'} anzeigen`}
        </button>
      )}

      {cancelTarget && (
        <div className="osteo-overlay" onClick={() => !cancelBusy && setCancelTarget(null)}>
          <div className="osteo-confirm-card" onClick={(e) => e.stopPropagation()}>
            <h3>Termin absagen?</h3>
            <p>
              {cancelTarget.name} · {new Date(cancelTarget.date + 'T' + cancelTarget.time)
                .toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' })} um {cancelTarget.time} Uhr
            </p>
            {cancelTarget.free ? (
              <p className="osteo-confirm-note ok">Die Absage ist kostenfrei (mehr als 24 Stunden vorher). Der Patient erhält eine Absage-Bestätigung per E-Mail.</p>
            ) : (
              <p className="osteo-confirm-note warn">⚠️ Kurzfristig: weniger als 24 Stunden vorher. Gemäß Honorarvereinbarung kann das volle Behandlungshonorar als Ausfallhonorar berechnet werden. Die Absage-Mail weist den Patienten darauf hin.</p>
            )}
            {cancelError && <div className="osteo-msg osteo-msg-err">{cancelError}</div>}
            <div className="osteo-confirm-actions">
              <button className="osteo-ghost-btn" disabled={cancelBusy} onClick={() => setCancelTarget(null)}>Zurück</button>
              <button className="osteo-primary-btn osteo-danger" disabled={cancelBusy} onClick={doCancel}>
                {cancelBusy ? 'Wird gesendet…' : 'Trotzdem absagen'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="osteo-toast">{toast}</div>}
    </div>
  );
}

// ====================================================================
// Neuer Termin (Formular)
// ====================================================================
function OsteoNeuerTermin({ allAppts, onCreated }) {
  const [type, setType] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [cc, setCc] = useState('+49');
  const [phone, setPhone] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('09:00');
  const [practitioner, setPractitioner] = useState(PRACTITIONERS[0]);
  const [note, setNote] = useState('');
  const [patQuery, setPatQuery] = useState('');
  const [msg, setMsg] = useState(null); // {kind:'err', text}
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  const patHits = useMemo(() => (patQuery.trim().length >= 2 ? patSearch(allAppts, patQuery) : []), [allAppts, patQuery]);

  const fillFromPatient = (p) => {
    setFirstName(p.firstName || '');
    setLastName(p.lastName || '');
    setEmail(p.email || '');
    setCc(p.cc || '+49');
    setPhone(p.phone || '');
    setPatQuery(((p.firstName || '') + ' ' + (p.lastName || '')).trim());
  };

  const clearForm = () => {
    setFirstName(''); setLastName(''); setEmail(''); setPhone(''); setNote(''); setPatQuery('');
    setType('');
  };

  const submit = async () => {
    setMsg(null);
    const data = {
      firstName: val(firstName), lastName: val(lastName),
      email: val(email), cc: val(cc), phone: val(phone).replace(/\D/g, ''),
      date, time, practitioner, note: val(note), type,
    };
    const err = validate(data);
    if (err) { setMsg({ kind: 'err', text: err }); return; }

    setBusy(true);
    try {
      const r = await fetch(CREATE_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const d = await r.json();
      if (r.ok) {
        clearForm();
        setToast('Bestätigung gesendet an ' + data.email);
        setTimeout(() => setToast(''), 2500);
        onCreated();
      } else {
        setMsg({ kind: 'err', text: d.error || 'Fehler beim Anlegen.' });
      }
    } catch {
      setMsg({ kind: 'err', text: 'Verbindungsfehler.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="osteo-card">
      <h3 className="osteo-card-h">Patient & Termin erfassen</h3>
      {msg && <div className={'osteo-msg osteo-msg-' + msg.kind}>{msg.text}</div>}

      <label className="osteo-label">Terminart *</label>
      <div className="osteo-typesel">
        {TYPES.map((t) => (
          <button key={t.key} type="button"
            className={'osteo-typebtn' + (type === t.key ? ' aktiv' : '')}
            onClick={() => setType(t.key)}>
            <span className="osteo-tb-title">{t.title}</span>
            <span className="osteo-tb-sub">{t.sub}</span>
          </button>
        ))}
      </div>
      <div className="osteo-hint" style={{ margin: '-6px 0 14px' }}>Bitte zuerst die Terminart wählen.</div>

      <label className="osteo-label">Bestehenden Patienten suchen</label>
      <div className="osteo-patsearch">
        <input className="osteo-input" autoComplete="off" placeholder="Name oder Telefon eingeben…"
          value={patQuery} onChange={(e) => setPatQuery(e.target.value)} />
        {patQuery.trim().length >= 2 && (
          <div className="osteo-pat-results show">
            {patHits.length ? patHits.map((p, i) => (
              <div className="osteo-pat-item" key={i} onClick={() => fillFromPatient(p)}>
                <div className="osteo-pi-name">{esc(p.firstName)} {esc(p.lastName)}</div>
                <div className="osteo-pi-sub">{[p.email, ((p.cc || '') + ' ' + (p.phone || '')).trim()].filter((s) => s && s.trim()).join(' · ')}</div>
              </div>
            )) : <div className="osteo-pat-empty">Kein bestehender Patient gefunden.</div>}
          </div>
        )}
      </div>

      <div className="osteo-row">
        <div><label className="osteo-label">Vorname *</label><input className="osteo-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="off" /></div>
        <div><label className="osteo-label">Nachname *</label><input className="osteo-input" value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="off" /></div>
      </div>

      <label className="osteo-label">E-Mail *</label>
      <input className="osteo-input" type="email" placeholder="patient@example.de" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />

      <label className="osteo-label">Handynummer</label>
      <div className="osteo-phone-row">
        <input className="osteo-input" value={cc} maxLength={5} onChange={(e) => setCc(e.target.value)} />
        <input className="osteo-input" inputMode="numeric" placeholder="151 23456789" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <div className="osteo-hint" style={{ marginTop: '-8px', marginBottom: '14px' }}>Optional. Ohne führende 0.</div>

      <div className="osteo-row">
        <div><label className="osteo-label">Datum *</label><input className="osteo-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div><label className="osteo-label">Uhrzeit *</label><input className="osteo-input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
      </div>

      <label className="osteo-label">Behandler:in</label>
      <select className="osteo-input" value={practitioner} onChange={(e) => setPractitioner(e.target.value)}>
        {PRACTITIONERS.map((p) => <option key={p}>{p}</option>)}
      </select>

      <label className="osteo-label">Notiz (intern)</label>
      <textarea className="osteo-input" rows={2} placeholder="optional" value={note} onChange={(e) => setNote(e.target.value)} />

      <button className="osteo-primary-btn" style={{ marginTop: '10px', width: '100%' }} disabled={busy} onClick={submit}>
        {busy ? 'Wird gesendet…' : 'Termin anlegen & Bestätigung per E-Mail senden'}
      </button>

      {toast && <div className="osteo-toast">{toast}</div>}
    </div>
  );
}

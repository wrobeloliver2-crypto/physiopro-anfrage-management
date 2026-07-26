import React, { useState, useEffect, useCallback, useMemo } from 'react';

// ====================================================================
// PhysioPro Kruse-Datenanforderungen — als Tab in der To-Do-Spalte des
// Rezeptionsdashboards, analog zu Osteo-Termine. Trackt den Weg einer
// Kruse-Dateneinwilligung (Bad Schwartau) von "Offen" bis die von der
// Kanzlei angeforderten Unterlagen vollständig da sind bzw. der Fall
// manuell auf "Erledigt" gesetzt wird.
// ====================================================================

const BACKEND_BASE = import.meta.env.VITE_BACKEND_BASE || '';
const LIST_URL = BACKEND_BASE + '/.netlify/functions/kruse-list-anfragen';
const UPDATE_URL = BACKEND_BASE + '/.netlify/functions/kruse-update-status';

const STATUS_FOLGE = ['Offen', 'Angefordert', 'Unterlagen vollständig', 'Erledigt'];
const STATUS_KLASSE = {
  'Offen': 'offen',
  'Angefordert': 'angefordert',
  'Unterlagen vollständig': 'vollstaendig',
  'Erledigt': 'erledigt',
};

const esc = (s) => (s || '').toString();

function formatDatum(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ====================================================================
// Hauptkomponente
// ====================================================================
export default function KruseAnfragen({ isReadOnly, currentUser }) {
  const [faelle, setFaelle] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadList = useCallback(async () => {
    setError('');
    try {
      const r = await fetch(LIST_URL);
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Konnte Kruse-Anfragen nicht laden.'); return; }
      setFaelle(d.faelle || []);
    } catch {
      setError('Verbindungsfehler.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  const tiles = useMemo(() => {
    const zaehlung = { 'Offen': 0, 'Angefordert': 0, 'Unterlagen vollständig': 0 };
    faelle.forEach((f) => {
      const s = f.status || 'Offen';
      if (zaehlung[s] !== undefined) zaehlung[s]++;
    });
    return zaehlung;
  }, [faelle]);

  const sortiert = useMemo(
    () => [...faelle].sort((a, b) => String(b.zeitstempel || '').localeCompare(String(a.zeitstempel || ''))),
    [faelle]
  );

  return (
    <div className="kruse-wrap">
      <div className="kruse-tiles">
        <div className="kruse-tile"><div className="kruse-tile-n">{tiles['Offen']}</div><div className="kruse-tile-l">offen</div></div>
        <div className="kruse-tile"><div className="kruse-tile-n">{tiles['Angefordert']}</div><div className="kruse-tile-l">angefordert</div></div>
        <div className="kruse-tile"><div className="kruse-tile-n">{tiles['Unterlagen vollständig']}</div><div className="kruse-tile-l">Unterlagen da</div></div>
      </div>

      {error && <div className="kruse-msg kruse-msg-err">{error}</div>}

      <div className="kruse-card">
        <h3 className="kruse-card-h">Datenanforderungen (Bad Schwartau)</h3>
        {loading ? (
          <div className="kruse-empty">Wird geladen…</div>
        ) : sortiert.length === 0 ? (
          <div className="kruse-empty">Keine offenen Datenanforderungen.</div>
        ) : (
          <div className="kruse-list">
            {sortiert.map((f) => (
              <KruseFall key={f.id || f.zeitstempel} fall={f} isReadOnly={isReadOnly} currentUser={currentUser} onChanged={loadList} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ====================================================================
// Ein Fall
// ====================================================================
function KruseFall({ fall, isReadOnly, currentUser, onChanged }) {
  const [notiz, setNotiz] = useState(fall.notizen || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => { setNotiz(fall.notizen || ''); }, [fall.notizen]);

  const status = fall.status || 'Offen';
  const idx = STATUS_FOLGE.indexOf(status);
  const naechsterStatus = idx >= 0 && idx < STATUS_FOLGE.length - 1 ? STATUS_FOLGE[idx + 1] : null;

  const sende = async (payload) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(UPDATE_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: fall.id, bearbeiter: currentUser, ...payload }),
      });
      const d = await r.json();
      if (r.ok) {
        onChanged();
      } else {
        setMsg({ kind: 'err', text: d.error || 'Fehler beim Speichern.' });
      }
    } catch {
      setMsg({ kind: 'err', text: 'Verbindungsfehler.' });
    } finally {
      setBusy(false);
    }
  };

  const notizSpeichern = () => {
    if (notiz !== (fall.notizen || '')) sende({ notiz });
  };

  return (
    <div className="kruse-fall">
      <div className="kruse-fall-top">
        <span className="kruse-fall-name">{esc(fall.name)}</span>
        <span className={'kruse-status-chip kruse-status-' + (STATUS_KLASSE[status] || 'offen')}>{status}</span>
      </div>
      <div className="kruse-fall-meta">
        {fall.geburtsdatum && <span>geb. {esc(fall.geburtsdatum)}</span>}
        {fall.telefon && <span> · {esc(fall.telefon)}</span>}
        {fall.zeitstempel && <span> · Einwilligung {formatDatum(fall.zeitstempel)}</span>}
      </div>
      {fall.hinweis && <div className="kruse-hinweis">{esc(fall.hinweis)}</div>}

      {msg && <div className={'kruse-msg kruse-msg-' + msg.kind}>{msg.text}</div>}

      {!isReadOnly && (
        <>
          <textarea className="kruse-notiz-feld" rows={2} placeholder="Notiz (z. B. wann bei der Kanzlei angefragt)…"
            value={notiz} onChange={(e) => setNotiz(e.target.value)} onBlur={notizSpeichern} />

          <div className="kruse-fall-actions">
            {naechsterStatus && (
              <button className="kruse-primary-btn" disabled={busy} onClick={() => sende({ status: naechsterStatus })}>
                {busy ? 'Wird gespeichert…' : `→ ${naechsterStatus}`}
              </button>
            )}
            {status !== 'Erledigt' && (
              <button className="kruse-ghost-btn" disabled={busy} onClick={() => sende({ status: 'Erledigt' })}>
                Als erledigt markieren
              </button>
            )}
          </div>
        </>
      )}

      {Array.isArray(fall.history) && fall.history.length > 0 && (
        <>
          <button className="kruse-history-toggle" onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? 'Verlauf ausblenden' : `Verlauf anzeigen (${fall.history.length})`}
          </button>
          {showHistory && (
            <div className="kruse-history-liste">
              {fall.history.map((h, i) => (
                <div className="kruse-history-eintrag" key={i}>
                  <span className="kruse-history-zeit">{formatDatum(h.zeitstempel)}</span>
                  <span className="kruse-history-text">{h.aktion}{h.von ? ' · ' + h.von : ''}{h.details ? ': ' + h.details : ''}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

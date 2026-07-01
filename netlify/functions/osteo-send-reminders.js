const { sheetReadAll, sheetUpdateCell, COL, berlinLocalToUtcMs, berlinHour } = require('./_osteo-lib');
const { sendMail, reminder3dHtml, reminder24hHtml } = require('./_osteo-mail');

// Läuft per Cron (Konfiguration in netlify.toml). Empfehlung: alle 30–60 Min.
// Idempotent: Status-Flags im Sheet verhindern Doppelversand.
//
// Schwellenlogik (robust gegen Cron-Ausfälle):
//   3-Tage-Erinnerung: sobald Termin <= 72h entfernt ist und noch nicht gesendet
//   24h-Erinnerung:    sobald Termin <= 24h entfernt ist und noch nicht gesendet
// Sollte ein Cron-Lauf ausfallen, wird beim nächsten Lauf nachgeholt – nichts geht verloren.
// Flags im Sheet stellen sicher, dass jede Stufe nur 1× sendet.
//
// Untergrenze für 3d (>24h), damit bei sehr kurzfristigen Terminen nicht beide
// Stufen quasi gleichzeitig feuern – kurzfristige Termine bekommen dann nur die 24h-Stufe.

const THRESHOLD_3D = 72;  // Stunden
const THRESHOLD_24H = 24; // Stunden

exports.handler = async ()=>{
  const now = Date.now();
  const results = { checked:0, sent3d:0, sent24h:0, errors:[] };

  // Ruhezeiten: nicht vor 8:00 / nicht nach 20:00 (Berliner Zeit, DST-sicher)
  const localHour = berlinHour(now);
  const quiet = localHour < 8 || localHour >= 20;
  if(quiet){
    console.log('[reminders] Ruhezeit – kein Versand.');
    return { statusCode:200, body:JSON.stringify({skipped:'quiet-hours'}) };
  }

  try{
    const all = await sheetReadAll();
    for(const a of all){
      if(!a.date || !a.time || !a.email) continue;
      if(a.status==='cancelled') continue; // abgesagte Termine bekommen keine Erinnerung
      const apptTime = berlinLocalToUtcMs(a.date, a.time);
      if(isNaN(apptTime) || apptTime < now) continue; // vergangen
      results.checked++;

      const hoursUntil = (apptTime - now) / 3600000;

      // 3-Tage-Erinnerung: sobald Termin <=72h entfernt ist.
      // KEINE Untergrenze: wird der Termin kurzfristig angelegt, geht die
      // 3-Tage-Mail trotzdem (sofort) raus – jede Stufe wird garantiert gesendet.
      if(!a.reminder3dSent && hoursUntil <= THRESHOLD_3D){
        try{
          await sendMail(a.email, 'Erinnerung: Ihr Osteopathie-Termin bei PhysioPro Lübeck', reminder3dHtml(a));
          await sheetUpdateCell(a._rowIndex, COL.reminder3dSent, '1');
          results.sent3d++;
        }catch(e){ results.errors.push(`3d ${a.id}: ${e.message}`); }
      }

      // 24h-Erinnerung: <=24h entfernt
      if(!a.reminder24hSent && hoursUntil <= THRESHOLD_24H){
        try{
          await sendMail(a.email, 'Morgen: Ihr Osteopathie-Termin bei PhysioPro Lübeck', reminder24hHtml(a));
          await sheetUpdateCell(a._rowIndex, COL.reminder24hSent, '1');
          results.sent24h++;
        }catch(e){ results.errors.push(`24h ${a.id}: ${e.message}`); }
      }
    }
  }catch(e){
    results.errors.push('global: '+e.message);
  }

  console.log('[reminders]', JSON.stringify(results));
  return { statusCode:200, body:JSON.stringify(results) };
};

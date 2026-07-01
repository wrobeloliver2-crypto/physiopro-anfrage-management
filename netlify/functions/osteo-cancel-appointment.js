import { sheetReadAll, sheetUpdateCell, COL, berlinLocalToUtcMs } from './_osteo-lib.js';
import { sendMail, cancellationHtml } from './_osteo-mail.js';

// Sagt einen Termin ab: bestimmt anhand der Berliner Zeit, ob rechtzeitig (>=24h,
// kostenfrei) oder kurzfristig (<24h, Ausfallhonorar-Pruefung), schickt die passende
// Absage-Mail und markiert den Termin im Sheet als storniert (loescht ihn nicht).
export const handler = async (event)=>{
  if(event.httpMethod!=='POST') return resp(405,{error:'Method not allowed'});

  try{
    const { id } = JSON.parse(event.body||'{}');
    if(!id) return resp(400,{error:'Termin-ID fehlt.'});

    const all = await sheetReadAll();
    const appt = all.find(a=>a.id===id);
    if(!appt) return resp(404,{error:'Termin nicht gefunden.'});
    if(appt.status==='cancelled') return resp(409,{error:'Termin ist bereits abgesagt.'});

    // Zeitabstand in Berliner Zeit bestimmen
    const now = Date.now();
    const apptMs = berlinLocalToUtcMs(appt.date, appt.time);
    const hoursUntil = (apptMs - now) / 3600000;
    const lateNotice = hoursUntil < 24; // <24h -> Ausfallhonorar-Pruefung

    // Absage-Mail senden (im Testmodus nur Log)
    let mailOk = false;
    const betreff = (appt.type==='check')
      ? 'Absage Ihres Osteopathie-Checks bei PhysioPro Lübeck'
      : 'Absage Ihres Osteopathie-Termins bei PhysioPro Lübeck';
    try{
      await sendMail(appt.email, betreff, cancellationHtml(appt, lateNotice));
      mailOk = true;
    }catch(e){ console.error('Absage-Mail:', e.message); }

    // Im Sheet als storniert markieren
    await sheetUpdateCell(appt._rowIndex, COL.status, 'cancelled');
    await sheetUpdateCell(appt._rowIndex, COL.cancelledAt, new Date(now).toISOString());

    return resp(200,{ ok:true, lateNotice, mailSent:mailOk });
  }catch(e){
    console.error(e);
    return resp(500,{error:'Serverfehler: '+e.message});
  }
};

function resp(code,obj){ return { statusCode:code, headers:{'Content-Type':'application/json'}, body:JSON.stringify(obj) }; }

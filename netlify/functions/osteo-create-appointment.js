import { sheetAppend, sheetUpdateCell, sheetReadAll, COL } from './_osteo-lib.js';
import { sendMail, confirmationHtml } from './_osteo-mail.js';
import crypto from 'crypto';

export const handler = async (event)=>{
  if(event.httpMethod!=='POST') return resp(405,{error:'Method not allowed'});

  try{
    const a = JSON.parse(event.body||'{}');
    // Serverseitige Mindestvalidierung (phone ist optional)
    if(!a.firstName||!a.lastName||!a.email||!a.date||!a.time)
      return resp(400,{error:'Pflichtfelder fehlen.'});
    // Terminart ist Pflicht (keine Vorauswahl)
    const type = (a.type==='check') ? 'check' : (a.type==='osteo' ? 'osteo' : '');
    if(!type)
      return resp(400,{error:'Bitte Terminart wählen.'});

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    // Zeile gemäß HEADERS-Reihenfolge (17 Spalten)
    const row = [
      id, createdAt, a.firstName, a.lastName, a.email,
      a.cc||'+49', a.phone, a.date, a.time,
      a.practitioner||'', a.note||'',
      '0','0','0',  // confirmSent, reminder3dSent, reminder24hSent
      'active', '',  // status, cancelledAt
      type  // type: 'osteo' | 'check'
    ];
    await sheetAppend(row);

    // Bestätigungsmail senden
    let confirmOk = false;
    const betreff = (type==='check')
      ? 'Ihr Osteopathie-Check bei PhysioPro Lübeck'
      : 'Ihr Osteopathie-Termin bei PhysioPro Lübeck';
    try{
      await sendMail(a.email, betreff, confirmationHtml(a));
      confirmOk = true;
    }catch(mailErr){
      console.error('Mailfehler:', mailErr.message);
    }

    // Status confirmSent setzen (Zeile ist die zuletzt angehängte – wir markieren best-effort)
    if(confirmOk){
      try{
        // letzte Zeile finden über erneutes Lesen wäre teuer; wir nehmen append-Antwort nicht,
        // daher markieren wir beim nächsten List-Aufruf nicht nötig. Wir setzen hier per Suche.
        const all = await sheetReadAll();
        const mine = all.find(r=>r.id===id);
        if(mine) await sheetUpdateCell(mine._rowIndex, COL.confirmSent, '1');
      }catch(e){ console.error('confirm-flag:', e.message); }
    }

    return resp(200,{ ok:true, id, confirmSent:confirmOk });
  }catch(e){
    console.error(e);
    return resp(500,{error:'Serverfehler: '+e.message});
  }
};

function resp(code,obj){ return { statusCode:code, headers:{'Content-Type':'application/json'}, body:JSON.stringify(obj) }; }

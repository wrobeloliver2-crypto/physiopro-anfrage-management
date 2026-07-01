// Gemeinsame Helfer für alle Functions
import crypto from 'crypto';

// ---------- Google Sheets via Service Account ----------
// Wir nutzen die REST-API mit JWT-Bearer (kein npm-Paket nötig außer für JWT-Signatur).
async function getGoogleAccessToken(){
  const email = process.env.OSTEO_GOOGLE_CLIENT_EMAIL;
  const key = (process.env.OSTEO_GOOGLE_PRIVATE_KEY||'').replace(/\\n/g,'\n');
  const now = Math.floor(Date.now()/1000);
  const header = b64url(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const claim = b64url(JSON.stringify({
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now+3600
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(header+'.'+claim);
  const sig = signer.sign(key);
  const jwt = header+'.'+claim+'.'+b64url(sig);
  const r = await fetch('https://oauth2.googleapis.com/token',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });
  const d = await r.json();
  if(!d.access_token) throw new Error('Google token: '+JSON.stringify(d));
  return d.access_token;
}
function b64url(input){
  return Buffer.from(input).toString('base64')
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

const SHEET_ID = () => process.env.OSTEO_SHEET_ID;
const RANGE = 'Termine!A:Q';
const HEADERS = ['id','createdAt','firstName','lastName','email','cc','phone',
  'date','time','practitioner','note','confirmSent','reminder3dSent','reminder24hSent',
  'status','cancelledAt','type'];

async function sheetAppend(row){
  const token = await getGoogleAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID()}/values/${encodeURIComponent(RANGE)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const r = await fetch(url,{
    method:'POST',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({values:[row]})
  });
  if(!r.ok) throw new Error('Sheet append: '+await r.text());
  return r.json();
}

async function sheetReadAll(){
  const token = await getGoogleAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID()}/values/${encodeURIComponent(RANGE)}`;
  const r = await fetch(url,{headers:{'Authorization':'Bearer '+token}});
  if(!r.ok) throw new Error('Sheet read: '+await r.text());
  const d = await r.json();
  const rows = d.values||[];
  if(rows.length<2) return [];
  return rows.slice(1).map((row,i)=>{
    const obj={_rowIndex:i+2}; // 1-basiert + Headerzeile
    HEADERS.forEach((h,j)=> obj[h] = row[j]||'');
    ['confirmSent','reminder3dSent','reminder24hSent'].forEach(k=> obj[k]= obj[k]==='1');
    return obj;
  });
}

async function sheetUpdateCell(rowIndex, colLetter, value){
  const token = await getGoogleAccessToken();
  const range = `Termine!${colLetter}${rowIndex}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID()}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  const r = await fetch(url,{
    method:'PUT',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({values:[[value]]})
  });
  if(!r.ok) throw new Error('Sheet update: '+await r.text());
}

// Spaltenbuchstaben für Status
const COL = { confirmSent:'L', reminder3dSent:'M', reminder24hSent:'N', status:'O', cancelledAt:'P' };

// ---------- Zeitzone Europe/Berlin ----------
// Wandelt ein lokales Datum/Uhrzeit-Paar (wie von der Rezeption eingegeben, gemeint
// als Berliner Zeit) in einen korrekten UTC-Zeitstempel (ms) um. Berücksichtigt
// automatisch Sommer-/Winterzeit (MESZ/MEZ), ohne externe Bibliothek.
//
// Ansatz: Wir bestimmen den UTC-Offset von Berlin zum fraglichen Zeitpunkt über
// Intl.DateTimeFormat und ziehen ihn ab. Iteration deckt den Grenzfall der
// Zeitumstellung sauber ab.
function berlinOffsetMinutes(utcMs){
  // Liefert den Offset (Minuten) von Europe/Berlin gegenüber UTC zum gegebenen Zeitpunkt.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone:'Europe/Berlin', hourCycle:'h23',
    year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit'
  });
  const parts = dtf.formatToParts(new Date(utcMs)).reduce((o,p)=>{ o[p.type]=p.value; return o; }, {});
  const asUTC = Date.UTC(+parts.year, +parts.month-1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUTC - utcMs) / 60000);
}

// date: "YYYY-MM-DD", time: "HH:MM" (als Berliner Lokalzeit gemeint) -> UTC-ms
function berlinLocalToUtcMs(date, time){
  if(!date || !time) return NaN;
  const [y,m,d] = date.split('-').map(Number);
  const [hh,mm] = time.split(':').map(Number);
  // Erster Schätzwert: als wäre die Eingabe UTC
  let guess = Date.UTC(y, m-1, d, hh, mm, 0);
  // Offset an diesem Punkt ermitteln und korrigieren (zweimal für DST-Grenzfälle)
  let off = berlinOffsetMinutes(guess);
  let utc = guess - off*60000;
  off = berlinOffsetMinutes(utc);
  utc = guess - off*60000;
  return utc;
}

// Aktuelle Berliner Stunde (0-23) zum gegebenen UTC-Zeitpunkt – für Ruhezeiten.
function berlinHour(utcMs){
  const h = new Intl.DateTimeFormat('en-US', { timeZone:'Europe/Berlin', hourCycle:'h23', hour:'2-digit' })
    .formatToParts(new Date(utcMs)).find(p=>p.type==='hour').value;
  return +h;
}

export {
  sheetAppend, sheetReadAll, sheetUpdateCell,
  HEADERS, COL,
  berlinLocalToUtcMs, berlinHour
};

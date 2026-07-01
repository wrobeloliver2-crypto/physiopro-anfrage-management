// E-Mail-Versand via Microsoft Graph (Client Credentials)
async function getGraphToken(){
  const tenant = process.env.OSTEO_GRAPH_TENANT_ID;
  const r = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({
      client_id: process.env.OSTEO_GRAPH_CLIENT_ID,
      client_secret: process.env.OSTEO_GRAPH_CLIENT_SECRET,
      scope:'https://graph.microsoft.com/.default',
      grant_type:'client_credentials'
    })
  });
  const d = await r.json();
  if(!d.access_token) throw new Error('Graph token: '+JSON.stringify(d));
  return d.access_token;
}

async function sendMail(to, subject, html){
  const token = await getGraphToken();
  const sender = process.env.OSTEO_GRAPH_SENDER; // z.B. info@physioproluebeck.de
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${sender}/sendMail`,{
    method:'POST',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({
      message:{
        subject,
        body:{contentType:'HTML',content:html},
        toRecipients:[{emailAddress:{address:to}}]
      },
      saveToSentItems:true
    })
  });
  if(!r.ok) throw new Error('sendMail: '+await r.text());
}

function esc(s){ return (s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// Terminart-Definition. a.type: 'check' = Osteo-Check (20 Min, 26,50 €),
// sonst = Osteopathie (60 Min, volles Behandlungshonorar).
function apptType(a){
  if(a && a.type==='check'){
    return {
      label: 'Osteopathie-Check',
      duration: '20 Minuten',
      // Wortlaut für die Ausfall-/Absage-Hinweise
      feeShort: '26,50 €',
      feeConfirm: 'eine Ausfallgebühr in Höhe von <strong>26,50 €</strong>',
      feeCancelLate: 'eine Ausfallgebühr in Höhe von <strong>26,50 €</strong>',
      priceLine: 'Osteopathie-Check · 20 Minuten · 26,50 €'
    };
  }
  return {
    label: 'Osteopathie',
    duration: '60 Minuten',
    feeShort: 'das volle Behandlungshonorar',
    feeConfirm: 'das <strong>volle Behandlungshonorar</strong> als Ausfallhonorar',
    feeCancelLate: 'das <strong>volle Behandlungshonorar</strong>',
    priceLine: 'Osteopathie · 60 Minuten'
  };
}

// Gemeinsames Mail-Gerüst (Header/Footer im PhysioPro-Style)
function mailShell(subtitle, inner){
  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"></head>
<body style="margin:0;background:#faf8f4;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#2b2b28">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f4;padding:24px 0"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border:1px solid #e5ddd0;border-radius:14px;overflow:hidden">
  <tr><td style="background:#55725e;padding:26px 30px">
    <div style="color:#faf8f4;font-size:18px;font-weight:600">PhysioPro Lübeck</div>
    <div style="color:#c4b09a;font-size:13px;margin-top:2px">Osteopathie · ${subtitle}</div>
  </td></tr>
  <tr><td style="padding:30px">${inner}</td></tr>
  <tr><td style="background:#faf8f4;border-top:1px solid #e5ddd0;padding:18px 30px">
    <div style="font-size:12px;color:#7a766d;line-height:1.5">
      PhysioPro Lübeck · Hanna Wrobel · Segeberger Str. 1 · 23617 Stockelsdorf<br>
      0451 / 400 730 73 · info@physioproluebeck.de · physioproluebeck.de
    </div>
  </td></tr>
</table></td></tr></table></body></html>`;
}

// Wiederverwendbarer Termin-Block
function apptBlock(a, dateStr, timeStr){
  const t = apptType(a);
  return `<table width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f4;border:1px solid #e5ddd0;border-radius:12px;margin-bottom:22px">
    <tr><td style="padding:18px 20px">
      <div style="font-size:13px;color:#7a766d">Datum &amp; Uhrzeit</div>
      <div style="font-size:16px;font-weight:600;color:#3f5648;margin:2px 0 12px">${dateStr} · ${timeStr}</div>
      <div style="font-size:13px;color:#7a766d">Behandler:in</div>
      <div style="font-size:15px;font-weight:600;color:#3f5648;margin:2px 0 12px">${esc(a.practitioner||'PhysioPro Team')}</div>
      <div style="font-size:13px;color:#7a766d">Behandlung</div>
      <div style="font-size:15px;font-weight:600;color:#3f5648;margin-top:2px">${t.priceLine}</div>
    </td></tr></table>`;
}
function fmtParts(a){
  const dt=new Date(a.date+'T'+a.time);
  return {
    long: dt.toLocaleDateString('de-DE',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}),
    time: a.time+' Uhr'
  };
}

// Terminbestätigung
function confirmationHtml(a){
  const {long, time} = fmtParts(a);
  const t = apptType(a);
  const inner = `
    <p style="margin:0 0 16px;font-size:15px">Hallo ${esc(a.firstName)} ${esc(a.lastName)},</p>
    <p style="margin:0 0 22px;font-size:15px;line-height:1.55">
      vielen Dank für Ihre Terminvereinbarung. Wir bestätigen Ihnen hiermit folgenden Termin (${t.label}):
    </p>
    ${apptBlock(a, long, time)}
    <div style="background:#f3ede2;border-left:3px solid #c4b09a;border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:22px">
      <div style="font-size:13px;font-weight:600;color:#3f5648;margin-bottom:6px">Hinweis zur Absage (Ausfallhonorar)</div>
      <div style="font-size:13px;color:#7a766d;line-height:1.5">
        Termine, die nicht mindestens <strong>24 Stunden</strong> vor Behandlungsbeginn abgesagt werden,
        werden mit ${t.feeConfirm} in Rechnung gestellt,
        da der reservierte Zeitraum dann nicht mehr anderweitig vergeben werden kann. Dieses Ausfallhonorar
        ist von privaten Krankenversicherungen und Beihilfestellen in der Regel nicht erstattungsfähig.
        Absagen nehmen wir gerne entgegen – telefonisch unter
        <a href="tel:+4945140073073" style="color:#55725e">0451 / 400 730 73</a> oder per E-Mail an
        <a href="mailto:info@physioproluebeck.de" style="color:#55725e">info@physioproluebeck.de</a>.
      </div>
    </div>
    <p style="margin:0 0 6px;font-size:14px;line-height:1.55">
      Zur Sicherheit erhalten Sie <strong>3 Tage</strong> und <strong>24 Stunden</strong> vor dem Termin
      noch eine kurze Erinnerung per E-Mail.
    </p>
    <p style="margin:18px 0 0;font-size:14px;line-height:1.55">
      Wir freuen uns auf Ihren Besuch.<br>Ihr PhysioPro-Team
    </p>`;
  return mailShell('Terminbestätigung', inner);
}

// Erinnerung 3 Tage vorher
function reminder3dHtml(a){
  const {long, time} = fmtParts(a);
  const t = apptType(a);
  const inner = `
    <p style="margin:0 0 16px;font-size:15px">Hallo ${esc(a.firstName)} ${esc(a.lastName)},</p>
    <p style="margin:0 0 22px;font-size:15px;line-height:1.55">
      wir möchten Sie an Ihren bevorstehenden Termin (${t.label}) erinnern:
    </p>
    ${apptBlock(a, long, time)}
    <div style="background:#f3ede2;border-left:3px solid #c4b09a;border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:22px">
      <div style="font-size:13px;color:#7a766d;line-height:1.5">
        Falls Ihnen der Termin nicht mehr passt, geben Sie uns bitte bis spätestens
        <strong>24 Stunden vorher</strong> Bescheid – telefonisch unter
        <a href="tel:+4945140073073" style="color:#55725e">0451 / 400 730 73</a> oder per E-Mail an
        <a href="mailto:info@physioproluebeck.de" style="color:#55725e">info@physioproluebeck.de</a>.
        So können wir den Platz noch anderweitig vergeben. Bei späterer Absage wird ${t.feeCancelLate}
        als Ausfallhonorar berechnet.
      </div>
    </div>
    <p style="margin:18px 0 0;font-size:14px;line-height:1.55">Bis bald!<br>Ihr PhysioPro-Team</p>`;
  return mailShell('Terminerinnerung', inner);
}

// Erinnerung 24 Stunden vorher
function reminder24hHtml(a){
  const {long, time} = fmtParts(a);
  const t = apptType(a);
  const inner = `
    <p style="margin:0 0 16px;font-size:15px">Hallo ${esc(a.firstName)} ${esc(a.lastName)},</p>
    <p style="margin:0 0 22px;font-size:15px;line-height:1.55">
      kurze Erinnerung: Ihr Termin (${t.label}) findet <strong>morgen</strong> statt.
    </p>
    ${apptBlock(a, long, time)}
    <p style="margin:0 0 6px;font-size:14px;line-height:1.55">
      Wir freuen uns auf Sie! Falls etwas dazwischenkommt, melden Sie sich bitte umgehend telefonisch
      unter <a href="tel:+4945140073073" style="color:#55725e">0451 / 400 730 73</a>.
    </p>
    <p style="margin:18px 0 0;font-size:14px;line-height:1.55">Ihr PhysioPro-Team</p>`;
  return mailShell('Terminerinnerung', inner);
}

// Absage-/Stornobestätigung. lateNotice = true, wenn <24h vor Termin (Ausfallhonorar-Prüfung).
function cancellationHtml(a, lateNotice){
  const {long, time} = fmtParts(a);
  const t = apptType(a);
  const noticeBox = lateNotice
    ? `<div style="background:#f6ede9;border-left:3px solid #b07d3f;border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:22px">
        <div style="font-size:13px;font-weight:600;color:#8a5a2b;margin-bottom:6px">Hinweis zum Ausfallhonorar</div>
        <div style="font-size:13px;color:#7a766d;line-height:1.5">
          Ihre Absage erreicht uns <strong>weniger als 24 Stunden</strong> vor dem Termin. Gemäß der mit Ihnen
          getroffenen Honorarvereinbarung kann in diesem Fall ${t.feeCancelLate} als
          Ausfallhonorar berechnet werden, sofern der reservierte Zeitraum nicht mehr anderweitig vergeben werden kann.
          Wir prüfen das im Einzelfall und melden uns gegebenenfalls bei Ihnen.
        </div>
      </div>`
    : `<div style="background:#eaf0ec;border-left:3px solid #55725e;border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:22px">
        <div style="font-size:13px;font-weight:600;color:#3f5648;margin-bottom:6px">Kostenfreie Absage</div>
        <div style="font-size:13px;color:#7a766d;line-height:1.5">
          Ihre Absage ist rechtzeitig (mehr als 24 Stunden vor dem Termin) bei uns eingegangen –
          es entstehen <strong>keine Kosten</strong>. Vielen Dank für die frühzeitige Information.
        </div>
      </div>`;
  const inner = `
    <p style="margin:0 0 16px;font-size:15px">Hallo ${esc(a.firstName)} ${esc(a.lastName)},</p>
    <p style="margin:0 0 22px;font-size:15px;line-height:1.55">
      wir bestätigen die Absage Ihres folgenden Termins (${t.label}):
    </p>
    ${apptBlock(a, long, time)}
    ${noticeBox}
    <p style="margin:0 0 6px;font-size:14px;line-height:1.55">
      Gerne vereinbaren wir einen neuen Termin mit Ihnen – melden Sie sich einfach telefonisch unter
      <a href="tel:+4945140073073" style="color:#55725e">0451 / 400 730 73</a> oder per E-Mail an
      <a href="mailto:info@physioproluebeck.de" style="color:#55725e">info@physioproluebeck.de</a>.
    </p>
    <p style="margin:18px 0 0;font-size:14px;line-height:1.55">Ihr PhysioPro-Team</p>`;
  return mailShell('Terminabsage', inner);
}

module.exports = { sendMail, confirmationHtml, reminder3dHtml, reminder24hHtml, cancellationHtml };

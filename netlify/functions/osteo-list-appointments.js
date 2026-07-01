import { sheetReadAll } from './_osteo-lib.js';

export const handler = async (event)=>{
  try{
    const all = await sheetReadAll();
    // Nur relevante Felder ans Frontend
    const appointments = all.map(a=>({
      id:a.id, firstName:a.firstName, lastName:a.lastName, email:a.email,
      cc:a.cc, phone:a.phone, date:a.date, time:a.time, practitioner:a.practitioner,
      confirmSent:a.confirmSent, reminder3dSent:a.reminder3dSent, reminder24hSent:a.reminder24hSent,
      status:a.status||'active', cancelledAt:a.cancelledAt||'', type:a.type||'osteo'
    }));
    return resp(200,{appointments});
  }catch(e){
    console.error(e);
    return resp(500,{error:e.message});
  }
};
function resp(code,obj){ return { statusCode:code, headers:{'Content-Type':'application/json'}, body:JSON.stringify(obj) }; }

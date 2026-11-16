'use strict';
// Run with the same DATABASE_URL as the API: node admin.js <command> [id]
const {createDatabase}=require('./database');
const db=createDatabase({databaseUrl:process.env.DATABASE_URL,dbPath:process.env.DB_PATH||'va_ca.db'});
const [,,cmd,arg]=process.argv;
const t=rows=>rows.length?console.table(rows):console.log('(nothing)');
const set=async(sql,...params)=>{const r=await db.run(sql,...params);console.log((r.changes||0)+' row(s) changed')};
const C={
 pending:async()=>t(await db.all("select id,role,name,gstin,kyc_note from users where verif='pending' and deleted=0 and name is not null")),
 approve:()=>set("update users set verif='approved' where id=? and role!='admin'",arg),
 reject:()=>set("update users set verif='rejected' where id=? and role!='admin'",arg),
 photos:async()=>t(await db.all("select id,owner_id,created from photos where status='pending'")),
 'approve-photo':()=>set("update photos set status='approved' where id=?",arg),
 'reject-photo':()=>set("update photos set status='rejected' where id=?",arg),
 reports:async()=>t(await db.all("select id,reporter,target,reason,created from reports where status='open'")),
 'close-report':()=>set("update reports set status='closed' where id=?",arg),
 'make-admin':()=>set("update users set role='admin',verif='approved' where phone=?",arg)
};

(async()=>{
 try{
  await db.ready;
  if(!C[cmd]){console.log('Commands: '+Object.keys(C).join(', '));process.exitCode=1;return}
  await C[cmd]();
 }catch(e){console.error('Admin command failed:',e);process.exitCode=1}
 finally{await db.close()}
})();

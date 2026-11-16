'use strict';
// Run ON the server:  node admin.js <command> [id]
const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.env.DB_PATH||'va_ca.db');const [,,cmd,arg]=process.argv;
const t=r=>r.length?console.table(r.map(x=>({...x}))):console.log('(nothing)');const set=(sql,...p)=>console.log(db.prepare(sql).run(...p).changes+' row(s) changed');
const C={
 pending:()=>t(db.prepare("select id,role,name,gstin,kyc_note from users where verif='pending' and deleted=0 and name is not null").all()),
 approve:()=>set("update users set verif='approved' where id=? and role!='admin'",arg),
 reject:()=>set("update users set verif='rejected' where id=? and role!='admin'",arg),
 photos:()=>t(db.prepare("select id,owner_id,created from photos where status='pending'").all()),
 'approve-photo':()=>set("update photos set status='approved' where id=?",arg),
 'reject-photo':()=>set("update photos set status='rejected' where id=?",arg),
 reports:()=>t(db.prepare("select id,reporter,target,reason,created from reports where status='open'").all()),
 'close-report':()=>set("update reports set status='closed' where id=?",arg),
 'make-admin':()=>set("update users set role='admin',verif='approved' where phone=?",arg)};
if(!C[cmd]){console.log('Commands: '+Object.keys(C).join(', '));process.exit(1)}C[cmd]();

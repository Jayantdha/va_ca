'use strict';
const express=require('express'),crypto=require('crypto'),sharp=require('sharp');
const {createDatabase}=require('./database'),{localStorage}=require('./storage');
const H=s=>crypto.createHash('sha256').update(s).digest('hex'),rid=()=>crypto.randomUUID(),tok=()=>crypto.randomBytes(32).toString('base64url');
const hmac=(k,s)=>crypto.createHmac('sha256',k).update(s).digest('hex');
const eq=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y)};
const DAY=864e5,CONSENT_V='2026-10',PHONE=/^[6-9]\d{9}$/;
const B36='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function gstinCheck(g){let s=0;for(let i=0;i<14;i++){const v=B36.indexOf(g[i])*(i%2?2:1);s+=Math.floor(v/36)+v%36}return B36[(36-s%36)%36]}
const validGstin=g=>typeof g==='string'&&/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)&&gstinCheck(g)===g[14];
const hashPw=p=>{const s=crypto.randomBytes(16);return s.toString('hex')+':'+crypto.scryptSync(p,s,64).toString('hex')};
const checkPw=(p,st)=>{const [s,h]=String(st||'0:0').split(':');return eq(crypto.scryptSync(p,Buffer.from(s,'hex'),64).toString('hex'),h||'')};
const imgKind=b=>b.length>12&&(b[0]===255&&b[1]===216&&b[2]===255?'jpeg':b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':(b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP')?'webp':null);
const CTRL=/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,LINK=/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|in|co|me|ly|xyz|link)\b/i;
function createApp(o){
 o=Object.assign({now:Date.now,dbPath:':memory:',databaseUrl:'',origins:[],pricePaise:49900,paymentsEnabled:true,captchaRequired:false,captcha:async()=>false,sms:async()=>{},uploadDir:require('node:path').join(__dirname,'uploads'),trustProxy:false},o);
 if(!o.secret||o.secret.length<32||(o.paymentsEnabled&&(!o.webhookSecret||o.webhookSecret.length<16)))throw new Error('secret (32+) and, when payments are enabled, webhookSecret (16+) required');
 const now=o.now,store=createDatabase({databaseUrl:o.databaseUrl,dbPath:o.dbPath}),storage=o.storage||localStorage(o.uploadDir);
 const gw=o.paymentsEnabled?(o.gateway||{name:'generic',verify:(raw,h)=>eq(h['x-signature']||'',hmac(o.webhookSecret,raw)),parse:e=>{if(typeof e.created_at!=='number')throw new Error('no time');return e},createOrder:async()=>({order_id:'order_'+crypto.randomBytes(9).toString('hex')}),checkout:()=>({})}):null;
 const {db,get,all,run,ready,close}=store;
 const buckets=new Map();const rl=(k,max,win)=>{const t=now(),a=(buckets.get(k)||[]).filter(x=>t-x<win);if(a.length>=max){buckets.set(k,a);return false}a.push(t);buckets.set(k,a);return true};
 function newSession(uid,device){const a=tok(),r=tok(),session={access:a,refresh:r,expires_in:900};
  const saved=run('insert into sessions(id,user_id,access_hash,access_exp,refresh_hash,refresh_exp,device,created) values(?,?,?,?,?,?,?,?)',rid(),uid,H(a),now()+15*60000,H(r),now()+30*DAY,String(device||'').slice(0,80),now());
  return saved&&typeof saved.then==='function'?saved.then(()=>session):session}
 const isBlocked=async(a,b)=>!!(await get('select 1 from blocks where (blocker=? and blocked=?) or (blocker=? and blocked=?)',a,b,b,a));
 const app=express();app.disable('x-powered-by');app.set('trust proxy',o.trustProxy);
 const A=f=>(q,s,n)=>Promise.resolve().then(()=>f(q,s)).catch(n),no=(s,c,m)=>s.status(c).json({error:m});
 app.use((q,s,n)=>{s.set({'X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",'Strict-Transport-Security':'max-age=63072000; includeSubDomains','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-site'});
  const g=q.get('origin');if(g&&o.origins.includes(g))s.set({'Access-Control-Allow-Origin':g,Vary:'Origin','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE'});
  if(q.method==='OPTIONS')return s.status(204).end();if(!rl('ip:'+q.ip,300,60000))return no(s,429,'Slow down');n()});
 const auth=roles=>(q,s,n)=>{const h=q.headers.authorization||'',t=h.startsWith('Bearer ')?h.slice(7):'';if(!t)return no(s,401,'Login required');
  A(async()=>{const u=await get('select s.id as sid,u.* from sessions s join users u on u.id=s.user_id where s.access_hash=? and s.revoked=0 and s.access_exp>? and u.deleted=0',H(t),now());
   if(!u)return no(s,401,'Login required');if(roles&&!roles.includes(u.role))return no(s,403,'Not allowed');if(!rl('u:'+u.id,120,60000))return no(s,429,'Slow down');q.u=u;n()})(q,s,n)};
 const ok=u=>u.verif==='approved';
 // ---- 1. payment webhook: the ONLY place a payment becomes "paid" (raw body, signed)
 app.post('/webhooks/payment',express.raw({type:'*/*',limit:'100kb'}),A(async(q,s)=>{
  if(!o.paymentsEnabled)return no(s,503,'Payments are disabled');
  if(!Buffer.isBuffer(q.body)||!gw.verify(q.body,q.headers))return s.status(401).end();
  let e;try{e=gw.parse(JSON.parse(q.body.toString('utf8')),q.headers)}catch{return s.status(400).end()}
  if(e&&e.ignore)return s.json({ok:true,ignored:true});
  if(!e||!e.event_id||!e.order_id||(e.created_at!=null&&(typeof e.created_at!=='number'||Math.abs(now()-e.created_at)>300000)))return s.status(400).json({error:'Rejected'});
  const p=await get('select * from payments where order_id=?',String(e.order_id));if(!p)return s.status(404).end();
  const event=await run('insert into webhook_events(id,at) values(?,?) on conflict(id) do nothing',String(e.event_id),now());
  if(!event.changes)return s.json({ok:true,duplicate:true});
  if(e.type==='payment.captured'&&e.amount_paise===p.amount_paise&&p.status==='created'){await run("update payments set status='paid',paid_at=? where id=?",now(),p.id);await run('update users set reveal_at=coalesce(reveal_at,?) where id=?',now()+7*DAY,p.user_id)}
  else if(e.type==='payment.failed'&&p.status==='created')await run("update payments set status='failed' where id=?",p.id);
  s.json({ok:true})}));
 // ---- 6. photo upload (raw binary, before json parser)
 app.post('/photos',auth(),express.raw({type:['image/jpeg','image/png','image/webp'],limit:'5mb'}),A(async(q,s)=>{
  if(!Buffer.isBuffer(q.body)||!q.body.length)return no(s,415,'Only JPG, PNG or WebP');
  if(!imgKind(q.body))return no(s,400,'Not a valid image');
  if((await get('select count(*) c from photos where owner_id=?',q.u.id)).c>=9)return no(s,400,'Photo limit reached');
  let out;try{out=await sharp(q.body,{limitInputPixels:40e6}).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).webp({quality:82}).toBuffer()}catch{return no(s,400,'Not a valid image')}
  let v='review';if(o.moderate){try{v=await o.moderate(out)}catch{v='review'}}if(v==='reject')return no(s,422,'This photo is not allowed');
  const id=rid(),st=v==='approve'?'approved':'pending';await storage.put(id+'.webp',out);await run('insert into photos values(?,?,?,?,?)',id,q.u.id,id+'.webp',st,now());s.status(201).json({id,status:st})}));
 app.use(express.json({limit:'20kb'}));
 // ---- 5. OTP + sessions (9)
 app.post('/auth/otp/send',A(async(q,s)=>{const {phone,captcha}=q.body;if(typeof phone!=='string'||!PHONE.test(phone))return no(s,400,'Enter a valid mobile number');
  if(o.captchaRequired&&!(await o.captcha(captcha,q.ip)))return no(s,400,'Captcha failed');
  if(!rl('otp:ip:'+q.ip,10,36e5)||!rl('otp:ph:'+phone,3,36e5)||!rl('otp:cool:'+phone,1,30000))return no(s,429,'Too many requests. Try later.');
  const c=String(crypto.randomInt(100000,1000000));await run('insert into otps(phone,code_hash,exp,attempts) values(?,?,?,0) on conflict(phone) do update set code_hash=excluded.code_hash,exp=excluded.exp,attempts=0',phone,hmac(o.secret,phone+':'+c),now()+300000);
  await o.sms(phone,`Your va_ca code is ${c}. Valid for 5 minutes. Do not share it.`,c);s.json({ok:true})}));
 app.post('/auth/otp/verify',A(async(q,s)=>{const {phone,code,role,consent,device}=q.body,bad=()=>no(s,400,'Invalid or expired code');
  if(!PHONE.test(phone||'')||!/^\d{6}$/.test(code||''))return bad();if(!rl('ver:ip:'+q.ip,20,36e5))return no(s,429,'Too many requests');
  const r=await get('select * from otps where phone=?',phone);if(!r||r.exp<now())return bad();
  if(r.attempts>=5){await run('delete from otps where phone=?',phone);return bad()}
  if(!eq(r.code_hash,hmac(o.secret,phone+':'+code))){await run('update otps set attempts=attempts+1 where phone=?',phone);return bad()}
  let u=await get('select * from users where phone=? and deleted=0',phone);
  if(!u){if(!['business','influencer'].includes(role))return no(s,400,'Choose a role');if(!consent||consent.accepted!==true||consent.version!==CONSENT_V)return no(s,400,'Consent required');
   u={id:rid()};await run('insert into users(id,phone,role,consent_v,consent_at,created) values(?,?,?,?,?,?)',u.id,phone,role,CONSENT_V,now(),now())}
  await run('delete from otps where phone=?',phone);s.json(await newSession(u.id,device))}));
 app.post('/auth/login',A(async(q,s)=>{const {phone,password,device}=q.body,fail=()=>no(s,401,'Wrong mobile number or password');
  if(!PHONE.test(phone||'')||typeof password!=='string'||password.length>64)return fail();
  if(!rl('login:ph:'+phone,5,15*60000)||!rl('login:ip:'+q.ip,30,15*60000))return no(s,429,'Too many tries. Wait 15 minutes.');
  const u=await get('select * from users where phone=? and deleted=0',phone);const good=checkPw(password,u&&u.pass_hash);if(!u||!u.pass_hash||!good)return fail();s.json(await newSession(u.id,device))}));
 app.post('/auth/password',auth(),A(async(q,s)=>{const p=q.body.password;if(typeof p!=='string'||p.length<8||p.length>64)return no(s,400,'Password must be 8 to 64 characters');await run('update users set pass_hash=? where id=?',hashPw(p),q.u.id);s.json({ok:true})}));
 app.post('/auth/refresh',A(async(q,s)=>{const t=q.body.refresh;if(typeof t!=='string')return no(s,401,'Login required');const h=H(t);
  const used=await get('select session_id from used_refresh where hash=?',h);if(used){const x=await get('select user_id from sessions where id=?',used.session_id);if(x)await run('update sessions set revoked=1 where user_id=?',x.user_id);return no(s,401,'Login required')}
  const x=await get('select s.* from sessions s join users u on u.id=s.user_id where s.refresh_hash=? and s.revoked=0 and s.refresh_exp>? and u.deleted=0',h,now());if(!x)return no(s,401,'Login required');
  const a=tok(),r=tok();await run('insert into used_refresh values(?,?)',h,x.id);await run('update sessions set access_hash=?,access_exp=?,refresh_hash=?,refresh_exp=? where id=?',H(a),now()+15*60000,H(r),now()+30*DAY,x.id);s.json({access:a,refresh:r,expires_in:900})}));
 app.post('/auth/logout',auth(),A(async(q,s)=>{await run('update sessions set revoked=1 where id=?',q.u.sid);s.json({ok:true})}));
 app.post('/auth/logout-all',auth(),A(async(q,s)=>{await run('update sessions set revoked=1 where user_id=?',q.u.id);s.json({ok:true})}));
 app.get('/me/sessions',auth(),A(async(q,s)=>s.json(await all('select id,device,created,id=? as current from sessions where user_id=? and revoked=0 and refresh_exp>?',q.u.sid,q.u.id,now()))));
 // ---- profile + 4. verification
 app.get('/me',auth(),(q,s)=>{const u=q.u;s.json({id:u.id,role:u.role,name:u.name,bio:u.bio,niche:u.niche,gstin:u.gstin,verification:u.verif,reveal_at:u.role==='influencer'?u.reveal_at:undefined})});
 app.patch('/me',auth(),A(async(q,s)=>{const {name,bio,niche,gstin}=q.body,u=q.u,t=(v,n)=>typeof v==='string'&&v.length>0&&v.length<=n;
  if(name!==undefined&&!t(name,60)||bio!==undefined&&typeof bio!=='string'||bio&&bio.length>300||niche!==undefined&&!t(niche,40))return no(s,400,'Invalid profile data');
  if(gstin!==undefined){if(u.role!=='business'||!validGstin(gstin))return no(s,400,'Invalid GSTIN');let kn=null;if(o.kyc){try{const k=await o.kyc(gstin);kn=JSON.stringify({legal_name:k&&k.legalName,status:k&&k.status})}catch{kn='lookup failed'}}await run("update users set gstin=?,verif='pending',kyc_note=? where id=?",gstin,kn,u.id)}
  await run('update users set name=coalesce(?,name),bio=coalesce(?,bio),niche=coalesce(?,niche) where id=?',name??null,bio??null,niche??null,u.id);s.json({ok:true})}));
 app.get('/admin/verifications',auth(['admin']),A(async(q,s)=>s.json(await all("select id,role,name,gstin,kyc_note from users where verif='pending' and deleted=0 and name is not null and (role='influencer' or gstin is not null)"))));
 app.post('/admin/verifications/:id',auth(['admin']),A(async(q,s)=>{if(typeof q.body.approve!=='boolean')return no(s,400,'approve must be true or false');await run('update users set verif=? where id=? and role!=\'admin\'',q.body.approve?'approved':'rejected',q.params.id);s.json({ok:true})}));
 app.get('/admin/reports',auth(['admin']),A(async(q,s)=>s.json(await all("select * from reports where status='open' order by created limit 100"))));
 app.post('/admin/photos/:id',auth(['admin']),A(async(q,s)=>{if(typeof q.body.approve!=='boolean')return no(s,400,'approve must be true or false');await run('update photos set status=? where id=?',q.body.approve?'approved':'rejected',q.params.id);s.json({ok:true})}));
 // ---- 8. discovery (login required, capped, rate limited)
 app.get('/discover',auth(['business']),A(async(q,s)=>{if(!ok(q.u))return no(s,403,'Verification pending');
  const lim=Math.min(Math.max(parseInt(q.query.limit)||20,1),20),off=Math.min(Math.max(parseInt(q.query.cursor)||0,0),500);
  const rows=await all("select u.id,u.name,u.niche,u.bio from users u where u.role='influencer' and u.verif='approved' and u.deleted=0 and not exists(select 1 from blocks b where (b.blocker=? and b.blocked=u.id) or (b.blocker=u.id and b.blocked=?)) order by u.created,u.id limit ? offset ?",q.u.id,q.u.id,lim,off);
  const items=await Promise.all(rows.map(async r=>({...r,photos:(await all("select id from photos where owner_id=? and status='approved'",r.id)).map(p=>p.id)})));
  s.json({items,next:rows.length===lim?off+lim:null})}));
 // ---- likes + 2. 7-day hold (server clock only)
 app.post('/likes',auth(['business']),A(async(q,s)=>{if(!ok(q.u))return no(s,403,'Verification pending');const to=q.body.to;
  const t=typeof to==='string'&&await get("select id from users where id=? and role='influencer' and verif='approved' and deleted=0",to);if(!t||await isBlocked(q.u.id,to))return no(s,404,'Not found');
  if(!rl('like:'+q.u.id,100,DAY))return no(s,429,'Daily like limit reached');await run('insert into likes values(?,?,?) on conflict do nothing',q.u.id,to,now());s.json({ok:true})}));
 app.get('/me/likes-received',auth(['influencer']),A(async(q,s)=>{const r=q.u.reveal_at;if(!r||now()<r)return s.json({locked:true,reveal_at:r||null});
  const rows=await all("select u.id,u.name,u.niche,u.bio from likes l join users u on u.id=l.from_id where l.to_id=? and u.deleted=0",q.u.id),items=[];
  for(const x of rows)if(!await isBlocked(q.u.id,x.id))items.push(x);
  s.json({locked:false,items})}));
 app.post('/likes/back',auth(['influencer']),A(async(q,s)=>{const r=q.u.reveal_at;if(!r||now()<r)return no(s,403,'Likes are not revealed yet');const to=q.body.to;
  if(typeof to!=='string'||!await get('select 1 from likes where from_id=? and to_id=?',to,q.u.id)||await isBlocked(q.u.id,to))return no(s,404,'Not found');
  let c=await get('select id from chats where a_id=? and b_id=?',to,q.u.id);
  if(!c){const id=rid();await run('insert into chats values(?,?,?,?) on conflict(a_id,b_id) do nothing',id,to,q.u.id,now());c=await get('select id from chats where a_id=? and b_id=?',to,q.u.id)}
  s.json({chat_id:c.id})}));
 // ---- payments (status read-only for the client)
 app.post('/payments/order',auth(['influencer']),A(async(q,s)=>{if(!o.paymentsEnabled)return no(s,503,'Payments are disabled');if(!ok(q.u))return no(s,403,'Verification pending');if(!rl('order:'+q.u.id,5,36e5))return no(s,429,'Too many orders');
  const id=rid();let od;try{od=await gw.createOrder(o.pricePaise,id)}catch{return no(s,502,'Payment service unavailable')}
  await run("insert into payments values(?,?,?,?,'created',null,?)",id,q.u.id,od.order_id,o.pricePaise,now());s.status(201).json({order_id:od.order_id,amount_paise:o.pricePaise,checkout:gw.checkout()})}));
 app.get('/payments/:oid/status',auth(),A(async(q,s)=>{if(!o.paymentsEnabled)return no(s,503,'Payments are disabled');const p=await get('select status,paid_at from payments where order_id=? and user_id=?',q.params.oid,q.u.id);p?s.json(p):no(s,404,'Not found')}));
 // ---- 3. photos & chats: object-level authorization on every request
 app.get('/photos/:id',auth(),A(async(q,s)=>{const p=await get('select * from photos where id=?',q.params.id),u=q.u;
  const can=p&&(p.owner_id===u.id||u.role==='admin'||(p.status==='approved'&&ok(u)&&!await isBlocked(u.id,p.owner_id)));if(!can)return no(s,404,'Not found');
  s.set({'Content-Type':'image/webp','Cache-Control':'private, no-store'}).send(await storage.get(p.file))}));
 app.delete('/photos/:id',auth(),A(async(q,s)=>{const p=await get('select * from photos where id=? and owner_id=?',q.params.id,q.u.id);if(!p)return no(s,404,'Not found');await storage.delete(p.file);await run('delete from photos where id=?',p.id);s.json({ok:true})}));
 const chatOf=q=>get('select * from chats where id=? and (a_id=? or b_id=?)',q.params.id,q.u.id,q.u.id);
 app.get('/chats',auth(),A(async(q,s)=>s.json(await all('select c.id,c.created,u.id as with_id,u.name as with_name from chats c join users u on u.id=case when c.a_id=? then c.b_id else c.a_id end where (c.a_id=? or c.b_id=?) and u.deleted=0',q.u.id,q.u.id,q.u.id))));
 app.get('/likes/sent',auth(['business']),A(async(q,s)=>s.json(await all('select u.id,u.name,u.niche,l.created,exists(select 1 from chats c where c.a_id=l.from_id and c.b_id=l.to_id) as matched from likes l join users u on u.id=l.to_id where l.from_id=? and u.deleted=0 order by l.created desc limit 100',q.u.id))));
 app.get('/me/photos',auth(),A(async(q,s)=>s.json(await all('select id,status from photos where owner_id=? order by created',q.u.id))));
 app.get('/chats/:id/messages',auth(),A(async(q,s)=>{if(!await chatOf(q))return no(s,404,'Not found');const b=parseInt(q.query.before)||now()+1;s.json((await all('select id,sender_id,body,has_link,created from messages where chat_id=? and created<? order by created desc limit 50',q.params.id,b)).reverse())}));
 app.post('/chats/:id/messages',auth(),A(async(q,s)=>{const c=await chatOf(q);if(!c)return no(s,404,'Not found');const other=c.a_id===q.u.id?c.b_id:c.a_id;if(await isBlocked(q.u.id,other))return no(s,403,'You cannot message this user');
  let b=q.body.body;if(typeof b!=='string')return no(s,400,'Message required');b=b.replace(CTRL,'').trim();if(!b||b.length>1000)return no(s,400,'Message must be 1 to 1000 characters');
  if(!rl('msg:'+q.u.id,30,60000))return no(s,429,'Slow down');const id=rid(),l=LINK.test(b)?1:0;await run('insert into messages values(?,?,?,?,?,?)',id,c.id,q.u.id,b,l,now());s.status(201).json({id,has_link:!!l})}));
 // ---- 7. block / report
 app.post('/block',auth(),A(async(q,s)=>{const t=q.body.user;if(typeof t!=='string'||t===q.u.id||!await get('select 1 from users where id=?',t))return no(s,404,'Not found');await run('insert into blocks values(?,?) on conflict do nothing',q.u.id,t);s.json({ok:true})}));
 app.post('/report',auth(),A(async(q,s)=>{const {target,message_id,reason}=q.body;if(typeof target!=='string'||typeof reason!=='string'||!reason||reason.length>500||!await get('select 1 from users where id=?',target))return no(s,400,'Invalid report');
  if(!rl('rep:'+q.u.id,10,DAY))return no(s,429,'Too many reports');await run('insert into reports(id,reporter,target,message_id,reason,created) values(?,?,?,?,?,?)',rid(),q.u.id,target,typeof message_id==='string'?message_id:null,reason,now());s.status(201).json({ok:true})}));
 // ---- 10. privacy: consent, export, delete
 app.get('/consent/current',(q,s)=>s.json({version:CONSENT_V,text:'We store your profile, likes, chats and payment records to run va_ca. You can export or delete your data any time.'}));
 app.get('/me/export',auth(),A(async(q,s)=>{const u=q.u,[likes_sent,messages_sent,photos,payments,sessions]=await Promise.all([
  all('select to_id,created from likes where from_id=?',u.id),all('select chat_id,body,created from messages where sender_id=?',u.id),all('select id,status,created from photos where owner_id=?',u.id),all('select order_id,amount_paise,status,paid_at from payments where user_id=?',u.id),all('select device,created from sessions where user_id=?',u.id)]);
  s.json({profile:{id:u.id,phone:u.phone,role:u.role,name:u.name,bio:u.bio,niche:u.niche,gstin:u.gstin,verification:u.verif,consent_version:u.consent_v,consent_at:u.consent_at},likes_sent,messages_sent,photos,payments,sessions})}));
 app.delete('/me',auth(),A(async(q,s)=>{if(q.body.confirm!=='DELETE')return no(s,400,'Send {"confirm":"DELETE"}');const u=q.u;if(u.role==='admin')return no(s,403,'Not allowed');
  for(const p of await all('select file from photos where owner_id=?',u.id))await storage.delete(p.file);
  await run('delete from photos where owner_id=?',u.id);await run('delete from messages where sender_id=?',u.id);await run('delete from chats where a_id=? or b_id=?',u.id,u.id);await run('delete from likes where from_id=? or to_id=?',u.id,u.id);await run('delete from blocks where blocker=? or blocked=?',u.id,u.id);await run('delete from otps where phone=?',u.phone);await run('update sessions set revoked=1 where user_id=?',u.id);
  await run("update users set phone=?,name=null,bio=null,niche=null,gstin=null,pass_hash=null,deleted=1 where id=?",'deleted:'+u.id,u.id);s.json({ok:true,note:'Payment records are kept as required for accounts and tax.'})}));
 app.get('/health',(q,s)=>s.json({ok:true}));
 app.use((q,s)=>no(s,404,'Not found'));
 app.use((e,q,s,n)=>{const c=e.status&&e.status<500?e.status:500;if(c===500)console.error(e);no(s,c,c===413?'Too large':c===500?'Server error':'Bad request')});
 return{app,db,newSession,run,get,all,ready,close};
}
module.exports={createApp,gstinCheck,validGstin,CONSENT_V};

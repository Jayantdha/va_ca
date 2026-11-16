'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),crypto=require('crypto'),fs=require('fs'),os=require('os'),path=require('path'),sharp=require('sharp');
const {createApp,gstinCheck,CONSENT_V}=require('./server');
const SECRET='s'.repeat(40),WH='w'.repeat(20),T={t:1_800_000_000_000},sent=[];
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'va-'));
const S=createApp({secret:SECRET,webhookSecret:WH,now:()=>T.t,uploadDir:dir,sms:async(p,m)=>{sent.push({p,m})},captchaRequired:true,captcha:async t=>t==='ok'});
let srv,base;before(()=>new Promise(r=>{srv=S.app.listen(0,()=>{base='http://127.0.0.1:'+srv.address().port;r()})}));after(()=>srv.close());
const call=async(m,p,{tok,body,raw,ct,hdr}={})=>{const h={...(hdr||{})};if(tok)h.authorization='Bearer '+tok;let b;if(raw){b=raw;h['content-type']=ct}else if(body!==undefined){b=JSON.stringify(body);h['content-type']='application/json'}
 const r=await fetch(base+p,{method:m,headers:h,body:b});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}return{s:r.status,j,h:r.headers,raw:t}};
let n=0;const phone=()=>'9'+String(100000000+(n++));
function mk(role,{approved=true,name='User'}={}){const id=crypto.randomUUID();S.run("insert into users(id,phone,role,name,verif,consent_v,consent_at,created) values(?,?,?,?,?,?,?,?)",id,phone(),role,name,approved?'approved':'pending',CONSENT_V,T.t,T.t+n);return{id,...S.newSession(id,'test')}}
const sign=b=>crypto.createHmac('sha256',WH).update(b).digest('hex');
const hook=async(ev,sig)=>{const b=JSON.stringify(ev);return call('POST','/webhooks/payment',{raw:Buffer.from(b),ct:'application/json',hdr:{'x-signature':sig??sign(b)}})};
const png=()=>sharp({create:{width:20,height:20,channels:3,background:'#c33'}}).png().toBuffer();
const consent={accepted:true,version:CONSENT_V};
test('1. payment: only a signed webhook can mark paid',async()=>{const inf=mk('influencer');const o=(await call('POST','/payments/order',{tok:inf.access})).j;
 const ev=(x={})=>({event_id:crypto.randomUUID(),type:'payment.captured',order_id:o.order_id,amount_paise:o.amount_paise,created_at:T.t,...x});
 assert.equal((await hook(ev(),'0'.repeat(64))).s,401);                       // forged signature
 assert.equal((await call('POST','/webhooks/payment',{body:ev()})).s,401);   // client JSON, no signature
 assert.equal((await call('PATCH','/me',{tok:inf.access,body:{status:'paid',reveal_at:1}})).s,200);
 assert.equal((await call('GET','/payments/'+o.order_id+'/status',{tok:inf.access})).j.status,'created'); // client cannot self-mark
 await hook(ev({amount_paise:1})); assert.equal((await call('GET','/payments/'+o.order_id+'/status',{tok:inf.access})).j.status,'created'); // wrong amount
 assert.equal((await hook(ev({created_at:T.t-9e5}))).s,400);                  // stale
 const good=ev();assert.equal((await hook(good)).s,200);
 assert.equal((await call('GET','/payments/'+o.order_id+'/status',{tok:inf.access})).j.status,'paid');
 assert.equal((await hook(good)).j.duplicate,true);                           // replay is a no-op
 const other=mk('influencer');assert.equal((await call('GET','/payments/'+o.order_id+'/status',{tok:other.access})).s,404)});
test('2. 7-day hold is enforced by the server clock and no data leaks early',async()=>{const biz=mk('business'),inf=mk('influencer',{name:'Aanya'});
 await call('POST','/likes',{tok:biz.access,body:{to:inf.id}});
 let r=await call('GET','/me/likes-received',{tok:inf.access,hdr:{'x-time':String(T.t+9e12),date:new Date(T.t+9e12).toUTCString()}});
 assert.deepEqual(r.j,{locked:true,reveal_at:null});assert.ok(!r.raw.includes(biz.id));    // not paid: nothing, not even a count
 assert.equal((await call('POST','/likes/back',{tok:inf.access,body:{to:biz.id}})).s,403);
 const o=(await call('POST','/payments/order',{tok:inf.access})).j;await hook({event_id:'e1',type:'payment.captured',order_id:o.order_id,amount_paise:o.amount_paise,created_at:T.t});
 r=await call('GET','/me/likes-received',{tok:inf.access});assert.equal(r.j.locked,true);assert.ok(r.j.reveal_at&&!r.raw.includes(biz.id));
 T.t+=7*864e5-1000;let tk=S.newSession(inf.id,'t').access;assert.equal((await call('GET','/me/likes-received',{tok:tk})).j.locked,true);   // 1 second early: still locked
 T.t+=2000;tk=S.newSession(inf.id,'t').access;r=await call('GET','/me/likes-received',{tok:tk});assert.equal(r.j.locked,false);assert.equal(r.j.items[0].id,biz.id);
 assert.equal((await call('POST','/likes/back',{tok:tk,body:{to:biz.id}})).s,200)});
test('3. other users cannot reach my chat, photos or data (IDOR)',async()=>{const a=mk('business'),b=mk('influencer'),c=mk('business');
 const chat=crypto.randomUUID();S.run('insert into chats values(?,?,?,?)',chat,a.id,b.id,T.t);
 assert.equal((await call('POST','/chats/'+chat+'/messages',{tok:a.access,body:{body:'hello'}})).s,201);
 assert.equal((await call('GET','/chats/'+chat+'/messages',{tok:b.access})).j.length,1);
 assert.equal((await call('GET','/chats/'+chat+'/messages',{tok:c.access})).s,404);
 assert.equal((await call('POST','/chats/'+chat+'/messages',{tok:c.access,body:{body:'x'}})).s,404);
 assert.equal((await call('GET','/chats',{tok:c.access})).j.length,0);
 assert.equal((await call('GET','/me?user_id='+a.id,{tok:c.access})).j.id,c.id);           // client-supplied id is ignored
 const up=await call('POST','/photos',{tok:b.access,raw:await png(),ct:'image/png'});
 assert.equal((await call('GET','/photos/'+up.j.id,{tok:b.access})).s,200);
 assert.equal((await call('GET','/photos/'+up.j.id,{tok:c.access})).s,404);                 // pending: owner only
 const adm=mk('admin');await call('POST','/admin/photos/'+up.j.id,{tok:adm.access,body:{approve:true}});
 assert.equal((await call('GET','/photos/'+up.j.id,{tok:c.access})).s,200);
 const un=mk('business',{approved:false});assert.equal((await call('GET','/photos/'+up.j.id,{tok:un.access})).s,404);
 const ex=await call('GET','/me/export',{tok:c.access});assert.ok(!ex.raw.includes(a.id)&&!ex.raw.includes('pass_hash'))});
test('4. verification: GSTIN checked, admin approval needed',async()=>{const biz=mk('business',{approved:false}),inf=mk('influencer'),adm=mk('admin');
 assert.equal((await call('PATCH','/me',{tok:biz.access,body:{gstin:'27ABCDE1234F1ZX'}})).s,400);
 const base='27ABCDE1234F1Z',g=base+gstinCheck(base+'0');assert.equal((await call('PATCH','/me',{tok:biz.access,body:{gstin:g}})).s,200);
 assert.equal((await call('POST','/likes',{tok:biz.access,body:{to:inf.id}})).s,403);       // pending business cannot act
 assert.equal((await call('GET','/admin/verifications',{tok:biz.access})).s,403);          // not an admin
 assert.ok((await call('GET','/admin/verifications',{tok:adm.access})).j.some(x=>x.id===biz.id));
 await call('POST','/admin/verifications/'+biz.id,{tok:adm.access,body:{approve:true}});
 assert.equal((await call('POST','/likes',{tok:biz.access,body:{to:inf.id}})).s,200);
 assert.equal((await call('PATCH','/me',{tok:biz.access,body:{name:'Rohan'}})).s,200);
 assert.equal((await call('GET','/me',{tok:biz.access})).j.verification,'approved')});
test('5. OTP: stored hashed, expires, 5-attempt limit, single use, rate limits, captcha',async()=>{const p=phone(),otp=async()=>{await call('POST','/auth/otp/send',{body:{phone:p,captcha:'ok'}});return sent.at(-1).m.match(/\d{6}/)[0]},ver=(code,x={})=>call('POST','/auth/otp/verify',{body:{phone:p,code,role:'business',consent,...x}});
 assert.equal((await call('POST','/auth/otp/send',{body:{phone:p}})).s,400);                // no captcha
 const code=await otp();assert.ok(!JSON.stringify(S.all('select * from otps')).includes(code));   // stored hashed
 assert.equal((await call('POST','/auth/otp/send',{body:{phone:p,captcha:'ok'}})).s,429);   // 30s cooldown
 const wrong=code==='111111'?'222222':'111111';
 for(let i=0;i<5;i++)assert.equal((await ver(wrong)).s,400);
 assert.equal((await ver(code)).s,400);                                                      // locked even with the right code
 T.t+=36e5+1;const c2=await otp();
 assert.equal((await ver(c2,{consent:{accepted:false}})).s,400);                             // consent is mandatory
 assert.equal((await ver(c2)).s,200);
 T.t+=31000;const c3=await otp();T.t+=301000;assert.equal((await ver(c3)).s,400);            // expired after 5 min
 T.t+=31000;const c4=await otp();assert.equal((await ver(c4)).s,200);assert.equal((await ver(c4)).s,400); // single use
 const q=phone();T.t+=36e5+1;for(let i=0;i<3;i++){T.t+=31000;assert.equal((await call('POST','/auth/otp/send',{body:{phone:q,captcha:'ok'}})).s,200)}
 T.t+=31000;assert.equal((await call('POST','/auth/otp/send',{body:{phone:q,captcha:'ok'}})).s,429)}); // 3 per hour per phone
test('6. photos: type, size, disguised files, EXIF/GPS stripped, random names',async()=>{const u=mk('influencer');
 assert.equal((await call('POST','/photos',{tok:u.access,raw:Buffer.from('<svg onload=alert(1)>'),ct:'image/svg+xml'})).s,415);
 assert.equal((await call('POST','/photos',{tok:u.access,raw:Buffer.from('MZ not an image at all....'),ct:'image/png'})).s,400);
 assert.equal((await call('POST','/photos',{tok:u.access,raw:Buffer.concat([Buffer.from([255,216,255]),Buffer.from('<script>alert(1)</script>junkjunk')]),ct:'image/jpeg'})).s,400);
 assert.equal((await call('POST','/photos',{tok:u.access,raw:Buffer.alloc(6*1024*1024,1),ct:'image/png'})).s,413);
 const withExif=await sharp({create:{width:30,height:30,channels:3,background:'#39c'}}).jpeg().withMetadata({exif:{IFD0:{ImageDescription:'SECRET-HOME-ADDRESS'}}}).toBuffer();
 assert.ok(withExif.includes(Buffer.from('SECRET-HOME-ADDRESS')));
 const r=await call('POST','/photos',{tok:u.access,raw:withExif,ct:'image/jpeg'});assert.equal(r.s,201);
 const stored=fs.readFileSync(path.join(dir,r.j.id+'.webp'));assert.ok(!stored.includes(Buffer.from('SECRET-HOME-ADDRESS')));assert.equal(imgOf(stored),'webp');
 assert.match(r.j.id,/^[0-9a-f-]{36}$/);assert.equal((await call('GET','/photos/'+r.j.id,{tok:u.access})).h.get('x-content-type-options'),'nosniff')});
const imgOf=b=>b.subarray(8,12).toString()==='WEBP'?'webp':'other';
test('7. chat: length, links flagged, rate limit, block, report, no HTML execution',async()=>{const a=mk('business'),b=mk('influencer'),chat=crypto.randomUUID();S.run('insert into chats values(?,?,?,?)',chat,a.id,b.id,T.t);
 const send=(t,x)=>call('POST','/chats/'+chat+'/messages',{tok:t.access,body:{body:x}});
 assert.equal((await send(a,'x'.repeat(1001))).s,400);assert.equal((await send(a,'   ')).s,400);
 assert.equal((await send(a,'win money at bit.ly/xyz or http://scam.com')).j.has_link,true);assert.equal((await send(a,'nice to meet you')).j.has_link,false);
 const xss=await send(a,'<img src=x onerror=alert(1)>\u0000');assert.equal(xss.s,201);
 const m=await call('GET','/chats/'+chat+'/messages',{tok:b.access});assert.match(m.h.get('content-type'),/application\/json/);assert.equal(m.h.get('x-content-type-options'),'nosniff');assert.ok(!m.raw.includes('\\u0000'));
 await call('POST','/report',{tok:b.access,body:{target:a.id,reason:'scam links'}});assert.equal(S.all("select * from reports where target=?",a.id).length,1);
 await call('POST','/block',{tok:b.access,body:{user:a.id}});assert.equal((await send(a,'hi?')).s,403);assert.equal((await send(b,'hi?')).s,403);
 const c=mk('business'),d=mk('influencer'),ch2=crypto.randomUUID();S.run('insert into chats values(?,?,?,?)',ch2,c.id,d.id,T.t);let last;for(let i=0;i<31;i++)last=await call('POST','/chats/'+ch2+'/messages',{tok:c.access,body:{body:'m'+i}});assert.equal(last.s,429)});
test('8. scraping: login required, page size capped, rate limited, random ids',async()=>{assert.equal((await call('GET','/discover')).s,401);assert.equal((await call('GET','/photos/'+crypto.randomUUID())).s,401);
 const biz=mk('business');for(let i=0;i<25;i++)mk('influencer',{name:'I'+i});
 const r=await call('GET','/discover?limit=1000',{tok:biz.access});assert.equal(r.s,200);assert.ok(r.j.items.length<=20);assert.match(r.j.items[0].id,/^[0-9a-f-]{36}$/);
 assert.equal((await call('GET','/discover?cursor=999999',{tok:biz.access})).j.items.length,0);
 let st=200;for(let i=0;i<125&&st!==429;i++)st=(await call('GET','/me',{tok:biz.access})).s;assert.equal(st,429)});
test('9. sessions: 15-min access, rotating refresh, reuse revokes all, logout everywhere, hashed at rest',async()=>{const p=phone(),otp=async()=>{await call('POST','/auth/otp/send',{body:{phone:p,captcha:'ok'}});return sent.at(-1).m.match(/\d{6}/)[0]},ver=async(device,x={})=>(await call('POST','/auth/otp/verify',{body:{phone:p,code:await otp(),device,...x}})).j;
 const s1=await ver('Phone A',{role:'influencer',consent});
 const dump=JSON.stringify(S.all('select * from sessions'));assert.ok(!dump.includes(s1.access)&&!dump.includes(s1.refresh));
 assert.equal((await call('GET','/me',{tok:s1.access})).s,200);T.t+=15*60000+1;assert.equal((await call('GET','/me',{tok:s1.access})).s,401);
 const s2=(await call('POST','/auth/refresh',{body:{refresh:s1.refresh}})).j;assert.equal((await call('GET','/me',{tok:s2.access})).s,200);
 assert.equal((await call('POST','/auth/refresh',{body:{refresh:s1.refresh}})).s,401);       // stolen old token reused
 assert.equal((await call('GET','/me',{tok:s2.access})).s,401);                               // whole family revoked
 T.t+=36e5+1;const A1=await ver('Phone B');T.t+=31000;const A2=await ver('Laptop');
 assert.ok(A1.access&&A2.access);assert.equal((await call('GET','/me/sessions',{tok:A1.access})).j.length,2);
 await call('POST','/auth/logout-all',{tok:A1.access});assert.equal((await call('GET','/me',{tok:A2.access})).s,401)});
test('9b. password login: hashed, wrong password locks out',async()=>{const u=mk('business');await call('POST','/auth/password',{tok:u.access,body:{password:'short'}});assert.equal((await call('POST','/auth/password',{tok:u.access,body:{password:'short'}})).s,400);
 assert.equal((await call('POST','/auth/password',{tok:u.access,body:{password:'a-long-password'}})).s,200);const ph=S.get('select phone,pass_hash from users where id=?',u.id);assert.ok(!ph.pass_hash.includes('a-long-password'));
 assert.equal((await call('POST','/auth/login',{body:{phone:ph.phone,password:'a-long-password'}})).s,200);
 for(let i=0;i<4;i++)assert.equal((await call('POST','/auth/login',{body:{phone:ph.phone,password:'nope'+i}})).s,401);
 assert.equal((await call('POST','/auth/login',{body:{phone:ph.phone,password:'a-long-password'}})).s,429)});
test('10. privacy: consent required, export, delete erases personal data',async()=>{const u=mk('influencer',{name:'Aanya'}),pic=await call('POST','/photos',{tok:u.access,raw:await png(),ct:'image/png'});
 const o=(await call('POST','/payments/order',{tok:u.access})).j;assert.ok(fs.existsSync(path.join(dir,pic.j.id+'.webp')));
 assert.equal((await call('GET','/consent/current')).j.version,CONSENT_V);
 const ex=(await call('GET','/me/export',{tok:u.access})).j;assert.equal(ex.profile.name,'Aanya');
 assert.equal((await call('DELETE','/me',{tok:u.access,body:{}})).s,400);assert.equal((await call('DELETE','/me',{tok:u.access,body:{confirm:'DELETE'}})).s,200);
 const row=S.get('select * from users where id=?',u.id);assert.equal(row.name,null);assert.match(row.phone,/^deleted:/);assert.ok(!fs.existsSync(path.join(dir,pic.j.id+'.webp')));
 assert.equal((await call('GET','/me',{tok:u.access})).s,401);assert.equal(S.get('select count(*) c from payments where order_id=?',o.order_id).c,1)});
test('headers & errors: no stack traces, locked-down headers, bad JSON handled',async()=>{const r=await call('GET','/nothing');assert.equal(r.s,404);assert.equal(r.h.get('x-powered-by'),null);assert.match(r.h.get('content-security-policy'),/default-src 'none'/);
 const b=await call('POST','/auth/otp/send',{raw:Buffer.from('{bad json'),ct:'application/json'});assert.equal(b.s,400);assert.ok(!b.raw.includes('at '))});

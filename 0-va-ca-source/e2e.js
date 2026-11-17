'use strict';
// End-to-end: the real front-end (live mode) talking to the real backend, two people, full journey.
const {JSDOM}=require('jsdom');const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),assert=require('node:assert/strict');
const {createApp,gstinCheck}=require('./server');
const T={t:1_800_000_000_000},sent=[],WH='w'.repeat(20);
const S=createApp({secret:'s'.repeat(40),webhookSecret:WH,now:()=>T.t,uploadDir:fs.mkdtempSync(path.join(os.tmpdir(),'e2e-')),sms:async(p,m)=>{sent.push({p,m})}});
const html=fs.readFileSync('frontend/index.html','utf8');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const until=async(f,ms=8000,msg='')=>{const t=Date.now();while(Date.now()-t<ms){try{if(f())return}catch{}await sleep(40)}throw new Error('timeout '+msg)};
let steps=0;const ok=n=>{steps++;console.log('  ✓',n)};
(async()=>{
 const srv=await new Promise(r=>{const x=S.app.listen(0,()=>r(x))}),API='http://127.0.0.1:'+srv.address().port;
 const mkWin=()=>{const built=html.replace('window.VA_API="";window.VA_RZP="";window.VA_TS="";','window.VA_API="'+API+'";window.VA_RZP="1";window.VA_TS="";');const d=new JSDOM(built,{url:'http://front.test/',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.VA_API=API;w.VA_RZP='1';w.fetch=fetch;}});return d.window};
 const on=w=>[...w.document.querySelectorAll('.screen.on')].map(x=>x.id).join();
 const signup=async(w,role,name,phone,gst)=>{const $=i=>w.document.getElementById(i);await until(()=>$('cons'),3000,'ui');w.document.querySelector('.rb[data-role='+role+']').click();$('ts').click();
  $('ph').value=phone;$('nm').value=name;if(gst)$('gs').value=gst;$('pw2').value='secret123';$('pc').value='secret123';$('cons').checked=true;
  const n0=sent.length;$('sendotp').click();await until(()=>sent.length>n0,4000,'otp');$('otp').value=sent.at(-1).m.match(/\d{6}/)[0];
  await sleep(300);$('ago').click();return $};
 // 1. influencer signs up
 const inf=mkWin();let $i=await signup(inf,'i','Aanya','9876500001');await until(()=>on(inf)==='me',6000,'influencer home');ok('influencer signed up with OTP + password + consent, landed on own profile');
 assert.equal(S.get("select count(*) c from users where role='influencer' and name='Aanya'").c,1);
 // 2. business signs up with GSTIN
 const biz=mkWin();const g='27ABCDE1234F1Z'+gstinCheck('27ABCDE1234F1Z0');await signup(biz,'b','Rohan Traders','9876500002',g);await until(()=>on(biz)==='discover',6000,'business home');ok('business signed up with GSTIN');
 const brow=S.get("select * from users where name='Rohan Traders'");assert.equal(brow.gstin,g);assert.equal(brow.verif,'pending');
 await sleep(300);assert.equal(biz.document.querySelector('#discover .sf[style*="26px"]').textContent,'No profiles yet');ok('unverified business sees no profiles (server blocks discovery)');
 // 3. admin approves both
 S.run("update users set verif='approved' where name in ('Aanya','Rohan Traders')");
 biz.go('likes');biz.go('discover');await until(()=>biz.document.querySelector('#discover .sf[style*="26px"]').textContent==='Aanya',4000,'discover shows Aanya');ok('after admin approval, business sees Aanya in Discover');
 // 4. business likes her
 biz.document.querySelector('#discover .lk').click();await until(()=>S.get('select count(*) c from likes').c===1,4000,'like');ok('business liked Aanya (stored on server)');
 // 5. influencer: likes are locked until payment
 inf.go('me');await until(()=>/Pay to start/.test(inf.document.querySelector('#me .card').textContent),4000,'locked');
 assert.ok(!inf.document.body.textContent.includes('Rohan Traders liked you'));ok('influencer sees only "pay to start Reveal Week", no like data');
 // 6. payment: pay, signed webhook confirms
 inf.go('pay');await until(()=>/Pay securely/.test(inf.document.getElementById('paybtn').textContent),3000);inf.document.getElementById('paybtn').click();
 await until(()=>S.get('select count(*) c from payments').c===1,4000,'order');const pay=S.get('select * from payments');assert.equal(inf.document.getElementById('a').value,'499');
 const raw=Buffer.from(JSON.stringify({event_id:'ev1',type:'payment.captured',order_id:pay.order_id,amount_paise:pay.amount_paise,created_at:T.t}));
 const wr=await fetch(API+'/webhooks/payment',{method:'POST',headers:{'content-type':'application/json','x-signature':crypto.createHmac('sha256',WH).update(raw).digest('hex')},body:raw});assert.equal(wr.status,200);
 await until(()=>/received/.test(inf.document.getElementById('paybtn').textContent),9000,'paid shown');ok('payment shows Pending, then Received only after the signed webhook');
 // 7. still locked until day 7; then 7 days pass on the SERVER clock
 inf.go('me');await until(()=>/unlock on/.test(inf.document.querySelector('#me .card').textContent),4000,'unlock date');ok('likes show an unlock date, still no names');
 T.t+=7*864e5+1000;inf.go('me');await until(()=>/Rohan Traders liked you/.test(inf.document.querySelector('#me .card').textContent),6000,'revealed');ok('after 7 server-days (tokens had expired, refreshed silently) the like is revealed');
 // 8. influencer likes back -> chat
 inf.document.querySelectorAll('#me .card button')[1].click();await until(()=>on(inf)==='chat',4000,'chat');await until(()=>inf.document.querySelector('#chat .top .sf').textContent==='Rohan Traders',3000);ok('like back opens a chat with Rohan Traders');
 // 9. business sees the match, chats
 biz.go('likes');await until(()=>/Matched/.test(biz.document.getElementById('likes').textContent),4000,'matched');biz.document.querySelector('#likes .lrow').click();await until(()=>on(biz)==='chat',3000);
 await until(()=>biz.document.querySelector('#chat .top .sf').textContent==='Aanya',3000);const bm=biz.document.getElementById('m');bm.value='Hi Aanya, love your work <b>x</b>';biz.document.querySelectorAll('#chat button').forEach(b=>{if(b.textContent==='Send')b.click()});
 await until(()=>S.get('select count(*) c from messages').c===1,4000,'msg');ok('business sent a chat message');
 inf.go('ichat');await until(()=>[...inf.document.querySelectorAll('#chat .bub')].some(b=>b.textContent.includes('love your work')),5000,'received');
 assert.equal(inf.document.querySelectorAll('#chat .bub b').length,0);ok('influencer received it, HTML shown as plain text');
 // 10. logout locks the app; wrong role / other user cannot read
 biz.document.getElementById('logout').click();await until(()=>on(biz)==='auth',3000);biz.go('discover');assert.equal(on(biz),'auth');ok('after logout the business cannot reach app screens');
 assert.equal((await fetch(API+'/discover')).status,401);ok('API refuses requests without a token');
 console.log(`\nEND-TO-END PASSED (${steps} checks)`);srv.close();process.exit(0);
})().catch(e=>{console.error('E2E FAILED:',e.message);process.exit(1)});

'use strict';
// Provider adapters. NOT tested against the live services (no accounts here): check each against the
// provider's current docs and test in their sandbox/test mode before going live.
const crypto=require('crypto');
const hmac=(k,s)=>crypto.createHmac('sha256',k).update(s).digest('hex');
const eq=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y)};
const T=()=>AbortSignal.timeout(8000);
// Razorpay: signature = HMAC-SHA256(raw body, webhook secret), hex, header X-Razorpay-Signature; X-Razorpay-Event-Id for idempotency.
function razorpay({keyId,keySecret,webhookSecret,fetchFn=fetch}){
 return{name:'razorpay',
  verify:(raw,h)=>eq(h['x-razorpay-signature']||'',hmac(webhookSecret,raw)),
  parse:(j,h)=>{const p=j&&j.payload&&j.payload.payment&&j.payload.payment.entity;if(!p||!/^payment\./.test(j.event||''))return{ignore:true};
   return{event_id:String(h['x-razorpay-event-id']||''),type:j.event,order_id:p.order_id,amount_paise:p.amount,created_at:null}},
  createOrder:async(amount,receipt)=>{const r=await fetchFn('https://api.razorpay.com/v1/orders',{method:'POST',headers:{'content-type':'application/json',authorization:'Basic '+Buffer.from(keyId+':'+keySecret).toString('base64')},body:JSON.stringify({amount,currency:'INR',receipt:String(receipt).slice(0,40)}),signal:T()});
   if(!r.ok)throw new Error('order failed');const j=await r.json();if(!j.id)throw new Error('no order id');return{order_id:j.id}},
  checkout:()=>({provider:'razorpay',key_id:keyId})};
}
// Cloudflare Turnstile server-side check. Fails closed.
const turnstile=(secret,fetchFn=fetch)=>async(token,ip)=>{if(typeof token!=='string'||!token||token.length>2048)return false;
 try{const r=await fetchFn('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({secret,response:token,remoteip:String(ip||'')}),signal:T()});return (await r.json()).success===true}catch{return false}};
// MSG91 Flow API (needs a DLT-approved template that contains the OTP variable).
const msg91=({authKey,templateId,varName='OTP',fetchFn=fetch})=>async(phone,text,code)=>{
 const r=await fetchFn('https://control.msg91.com/api/v5/flow/',{method:'POST',headers:{authkey:authKey,'content-type':'application/json'},body:JSON.stringify({template_id:templateId,short_url:'0',recipients:[{mobiles:'91'+phone,[varName]:code}]}),signal:T()});
 if(!r.ok)throw new Error('sms failed')};
module.exports={razorpay,turnstile,msg91,hmac};

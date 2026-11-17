'use strict';
// Production start: set the environment variables listed in .env.example, then `node index.js`.
// Payments are opt-in in production; SMS and CAPTCHA remain required.
const {createApp}=require('./server'),A=require('./adapters');
const E=process.env,prod=E.NODE_ENV==='production';
const need=(...k)=>{const m=k.filter(x=>!E[x]);if(m.length)throw new Error('Missing environment variables: '+m.join(', '))};
need('SECRET');let sms,captcha,gateway,webhookSecret=E.WEBHOOK_SECRET;
const paymentsEnabled=!prod||E.ENABLE_PAYMENTS==='true';
if(prod){
 need('MSG91_AUTH_KEY','MSG91_TEMPLATE_ID','TURNSTILE_SECRET','ORIGINS');
 need('DATABASE_URL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_STORAGE_BUCKET');
 sms=A.msg91({authKey:E.MSG91_AUTH_KEY,templateId:E.MSG91_TEMPLATE_ID,varName:E.MSG91_VAR||'OTP'});captcha=A.turnstile(E.TURNSTILE_SECRET);
 if(paymentsEnabled){
  need('RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET');
  webhookSecret=E.RAZORPAY_WEBHOOK_SECRET;gateway=A.razorpay({keyId:E.RAZORPAY_KEY_ID,keySecret:E.RAZORPAY_KEY_SECRET,webhookSecret});
 }
}else{need('WEBHOOK_SECRET');sms=async(p,t)=>console.log('[DEV SMS]',p,t);captcha=async()=>true}
// Optional hooks (leave empty for manual review): moderate: async(webpBuffer)=>'approve'|'reject'|'review'  kyc: async(gstin)=>({legalName,status})
const storage=E.SUPABASE_URL&&E.SUPABASE_SERVICE_ROLE_KEY&&E.SUPABASE_STORAGE_BUCKET
 ?require('./storage').supabaseStorage({url:E.SUPABASE_URL,serviceKey:E.SUPABASE_SERVICE_ROLE_KEY,bucket:E.SUPABASE_STORAGE_BUCKET}):undefined;
const S=createApp({secret:E.SECRET,webhookSecret,gateway,paymentsEnabled,databaseUrl:E.DATABASE_URL,dbPath:E.DB_PATH||'va_ca.db',uploadDir:E.UPLOAD_DIR||'./uploads',storage,
 origins:(E.ORIGINS||'').split(',').filter(Boolean),trustProxy:E.TRUST_PROXY==='1'?1:false,captchaRequired:prod,sms,captcha,pricePaise:parseInt(E.PRICE_PAISE)||49900});
async function start(){
 await S.ready;
 const server=S.app.listen(E.PORT||3000,()=>console.log('va_ca API listening'));
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>Promise.resolve(S.close()).then(()=>process.exit(0),err=>{console.error(err);process.exit(1)})));
}
start().catch(async e=>{console.error('API startup failed:',e);try{await S.close()}catch(closeError){console.error('Database shutdown failed:',closeError)}process.exitCode=1});

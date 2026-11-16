'use strict';
// Production start: set the environment variables listed in .env.example, then `node index.js`.
// In production this refuses to start unless SMS, CAPTCHA and payments are really configured.
const {createApp}=require('./server'),A=require('./adapters');
const E=process.env,prod=E.NODE_ENV==='production';
const need=(...k)=>{const m=k.filter(x=>!E[x]);if(m.length)throw new Error('Missing environment variables: '+m.join(', '))};
need('SECRET');let sms,captcha,gateway,webhookSecret=E.WEBHOOK_SECRET;
if(prod){
 need('MSG91_AUTH_KEY','MSG91_TEMPLATE_ID','TURNSTILE_SECRET','RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET','ORIGINS');
 sms=A.msg91({authKey:E.MSG91_AUTH_KEY,templateId:E.MSG91_TEMPLATE_ID,varName:E.MSG91_VAR||'OTP'});captcha=A.turnstile(E.TURNSTILE_SECRET);
 webhookSecret=E.RAZORPAY_WEBHOOK_SECRET;gateway=A.razorpay({keyId:E.RAZORPAY_KEY_ID,keySecret:E.RAZORPAY_KEY_SECRET,webhookSecret});
}else{need('WEBHOOK_SECRET');sms=async(p,t)=>console.log('[DEV SMS]',p,t);captcha=async()=>true}
// Optional hooks (leave empty for manual review): moderate: async(webpBuffer)=>'approve'|'reject'|'review'  kyc: async(gstin)=>({legalName,status})
const {app}=createApp({secret:E.SECRET,webhookSecret,gateway,dbPath:E.DB_PATH||'va_ca.db',uploadDir:E.UPLOAD_DIR||'./uploads',
 origins:(E.ORIGINS||'').split(',').filter(Boolean),trustProxy:E.TRUST_PROXY==='1'?1:false,captchaRequired:prod,sms,captcha,pricePaise:parseInt(E.PRICE_PAISE)||49900});
app.listen(E.PORT||3000,()=>console.log('va_ca API listening'));

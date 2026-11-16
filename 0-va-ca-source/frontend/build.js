'use strict';
// Make the live website file:  node build.js --api https://your-api-address [--turnstile SITEKEY] [--razorpay]
// Writes dist/index.html (+ vercel.json). Without --api the page stays in demo mode.
const fs=require('fs'),a=process.argv.slice(2),g=n=>{const i=a.indexOf('--'+n);return i>=0?a[i+1]||'':''};
const api=(g('api')||'').trim().replace(/\/+$/,'');
const ts=g('turnstile'),rz=a.includes('--razorpay');
if(api && !/^https?:\/\/[^\s"']+$/.test(api) && !/^https?:\/\/localhost(?::\d+)?(?:\/.*)?$/.test(api) && !/^https?:\/\/127\.0\.0\.1(?::\d+)?(?:\/.*)?$/.test(api)){console.error('Usage: node build.js [--api https://your-api-address] [--turnstile SITEKEY] [--razorpay]');process.exit(1)}
let h=fs.readFileSync(__dirname+'/index.html','utf8');
const mark='window.VA_API="";window.VA_RZP="";window.VA_TS="";';if(!h.includes(mark))throw new Error('index.html marker not found');
h=h.replace(mark,`window.VA_API=${JSON.stringify(api)};window.VA_RZP=${JSON.stringify(rz?'1':'')};window.VA_TS=${JSON.stringify(ts)};`);
const script=["'unsafe-inline'"],frame=[],conn=api?[api]:[];
if(ts){script.push('https://challenges.cloudflare.com');frame.push('https://challenges.cloudflare.com')}
if(rz){script.push('https://checkout.razorpay.com');frame.push('https://api.razorpay.com','https://checkout.razorpay.com');conn.push('https://api.razorpay.com')}
const csp=`default-src 'none'; script-src ${script.join(' ')}; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src blob: data:; connect-src ${conn.join(' ')}; ${frame.length?'frame-src '+frame.join(' ')+'; ':''}base-uri 'none'; form-action 'none'`;
const re=/<meta http-equiv="Content-Security-Policy" content="[^"]*">/;if(!re.test(h))throw new Error('CSP tag not found');
h=h.replace(re,`<meta http-equiv="Content-Security-Policy" content="${csp}">`);
fs.mkdirSync(__dirname+'/dist',{recursive:true});fs.writeFileSync(__dirname+'/dist/index.html',h);fs.copyFileSync(__dirname+'/vercel.json',__dirname+'/dist/vercel.json');
console.log('Built dist/index.html for '+(api?'API '+api:'demo mode')+'. Upload the dist folder (index.html + vercel.json).');

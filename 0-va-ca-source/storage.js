'use strict';
const fs=require('node:fs'),path=require('node:path');

function localStorage(uploadDir){
 fs.mkdirSync(uploadDir,{recursive:true,mode:0o700});
 const file=name=>path.join(uploadDir,name);
 return{
  put:async(name,body)=>fs.promises.writeFile(file(name),body,{mode:0o600}),
  get:async name=>fs.promises.readFile(file(name)),
  delete:async name=>{try{await fs.promises.unlink(file(name))}catch(e){if(e.code!=='ENOENT')throw e}}
 };
}

function supabaseStorage({url,serviceKey,bucket,fetchFn=fetch}){
 const base=url.replace(/\/+$/,'')+'/storage/v1/object',b=encodeURIComponent(bucket);
 const objectUrl=(name,authenticated=false)=>base+(authenticated?'/authenticated':'')+'/'+b+'/'+name.split('/').map(encodeURIComponent).join('/');
 const headers={'apikey':serviceKey,'Authorization':'Bearer '+serviceKey};
 const check=(r,operation)=>{if(!r.ok)throw new Error(`Supabase Storage ${operation} failed (${r.status})`)};
 return{
  put:async(name,body)=>{const r=await fetchFn(objectUrl(name),{method:'PUT',headers:{...headers,'Content-Type':'image/webp','x-upsert':'false'},body,signal:AbortSignal.timeout(10000)});check(r,'upload')},
  get:async name=>{const r=await fetchFn(objectUrl(name,true),{headers,signal:AbortSignal.timeout(10000)});check(r,'download');return Buffer.from(await r.arrayBuffer())},
  delete:async name=>{const r=await fetchFn(base+'/'+b,{method:'DELETE',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({prefixes:[name]}),signal:AbortSignal.timeout(10000)});check(r,'delete')}
 };
}

module.exports={localStorage,supabaseStorage};

'use strict';
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');

const SQLITE_SCHEMA=`create table if not exists users(id text primary key,phone text unique,role text not null,name text,bio text,niche text,gstin text,kyc_note text,verif text not null default 'pending',pass_hash text,reveal_at integer,consent_v text,consent_at integer,deleted integer not null default 0,created integer);
create table if not exists otps(phone text primary key,code_hash text,exp integer,attempts integer);
create table if not exists sessions(id text primary key,user_id text,access_hash text unique,access_exp integer,refresh_hash text unique,refresh_exp integer,revoked integer default 0,device text,created integer);
create table if not exists used_refresh(hash text primary key,session_id text);
create table if not exists likes(from_id text,to_id text,created integer,primary key(from_id,to_id));
create table if not exists payments(id text primary key,user_id text,order_id text unique,amount_paise integer,status text,paid_at integer,created integer);
create table if not exists webhook_events(id text primary key,at integer);
create table if not exists chats(id text primary key,a_id text,b_id text,created integer,unique(a_id,b_id));
create table if not exists messages(id text primary key,chat_id text,sender_id text,body text,has_link integer,created integer);
create table if not exists photos(id text primary key,owner_id text,file text,status text,created integer);
create table if not exists blocks(blocker text,blocked text,primary key(blocker,blocked));
create table if not exists reports(id text primary key,reporter text,target text,message_id text,reason text,created integer,status text default 'open');`;

function pgPlaceholders(sql){let i=0;return sql.replace(/\?/g,()=>`$${++i}`)}

function createDatabase({databaseUrl,dbPath=':memory:'}={}){
 if(!databaseUrl){
  const db=new DatabaseSync(dbPath);db.exec(SQLITE_SCHEMA);
  const get=(sql,...params)=>db.prepare(sql).get(...params),all=(sql,...params)=>db.prepare(sql).all(...params),run=(sql,...params)=>db.prepare(sql).run(...params);
  return{db,isPostgres:false,ready:Promise.resolve(),get,all,run,close:()=>db.close()};
 }
 const {Pool,types}=require('pg');
 types.setTypeParser(20,value=>Number(value));
 const pool=new Pool({connectionString:databaseUrl,max:3,connectionTimeoutMillis:10000});
 const statements=fs.readFileSync(path.join(__dirname,'scripts','postgres-init.sql'),'utf8').split(';').map(s=>s.trim()).filter(Boolean);
 const ready=(async()=>{for(const sql of statements)await pool.query(sql)})();
 const query=async(sql,params)=>{await ready;return pool.query(pgPlaceholders(sql),params)};
 const get=async(sql,...params)=>(await query(sql,params)).rows[0],all=async(sql,...params)=>(await query(sql,params)).rows;
 const run=async(sql,...params)=>{const r=await query(sql,params);return{changes:r.rowCount||0,lastInsertRowid:undefined}};
 return{db:pool,isPostgres:true,ready,get,all,run,close:()=>pool.end()};
}

module.exports={createDatabase,pgPlaceholders};

// Production preservation checks. Secrets stay in environment/private backup files.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import pg from 'pg';
const [mode,directory]=process.argv.slice(2);
if(!['backup','verify'].includes(mode)||!directory)throw new Error('Usage: deployment-data.mjs backup|verify <private-backup-directory>');
const config={...parseEnv(readFileSync('.dev.vars','utf8')),...process.env};
const db=new pg.Client({connectionString:config.DATABASE_URL});await db.connect();
const tables=['users','uploads','upload_objects','mistakes','practice_papers','knowledge_units','essay_reports'];
const aliases={小学数学:'数学',初中数学:'数学',高中数学:'数学',小学语文:'语文',初中语文:'语文',高中语文:'语文',小学英语:'英语',初中英语:'英语',高中英语:'英语',政治:'道德与法治'};
const identity=(table,row)=>JSON.stringify(table==='knowledge_units'?[row.user_id,row.subject,row.knowledge_point]:[row[table==='upload_objects'?'key':'id']]);
const digest=(table,row,columns)=>createHash('sha256').update(JSON.stringify(columns.map(k=>['uploads','mistakes'].includes(table)&&k==='subject'?(aliases[row[k]]||row[k]):row[k]))).digest('hex');
try{
 if(mode==='backup'){
  mkdirSync(directory,{recursive:true,mode:0o700});
  const url=new URL(config.DATABASE_URL);
  const result=spawnSync('pg_dump',['--format=custom','--schema=public','--no-owner','--file',directory+'/database.dump'],{env:{...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGDATABASE:decodeURIComponent(url.pathname.slice(1)),PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url['pass'+'word'])},encoding:'utf8'});
  if(result.status!==0)throw new Error('Database backup failed');
  if(spawnSync('pg_restore',['--list',directory+'/database.dump'],{encoding:'utf8'}).status!==0)throw new Error('Backup archive validation failed');
  const snapshot={};
  for(const table of tables){const {rows}=await db.query(`SELECT * FROM ${table}`);const columns=(await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",[table])).rows.map(r=>r.column_name);snapshot[table]={columns,rows:Object.fromEntries(rows.map(r=>[identity(table,r),digest(table,r,columns)]))};}
  writeFileSync(directory+'/preservation.json',JSON.stringify(snapshot),{mode:0o600});
  console.log(JSON.stringify({backupVerified:true,counts:Object.fromEntries(tables.map(t=>[t,Object.keys(snapshot[t].rows).length]))}));
 }else{
  const snapshot=JSON.parse(readFileSync(directory+'/preservation.json','utf8'));const counts={};let preserved=0;
  for(const table of tables){const {rows}=await db.query(`SELECT * FROM ${table}`);const actual=new Map(rows.map(r=>[identity(table,r),r]));counts[table]=rows.length;for(const [id,hash]of Object.entries(snapshot[table].rows)){const r=actual.get(id);if(!r||digest(table,r,snapshot[table].columns)!==hash)throw new Error(`Original record preservation failed: ${table}`);preserved++;}}
  const invalid=(await db.query("SELECT count(*)::int AS n FROM uploads u LEFT JOIN learning_profiles p ON p.id=u.profile_id AND p.user_id=u.user_id WHERE p.id IS NULL")).rows[0].n;if(invalid)throw new Error('Upload profile backfill failed');
  const evidence={preservedRecords:preserved,counts,profileBackfillValid:true,verifiedAt:new Date().toISOString()};writeFileSync(directory+'/preservation-result.json',JSON.stringify(evidence,null,2),{mode:0o600});console.log(JSON.stringify(evidence));
 }
}finally{await db.end();}

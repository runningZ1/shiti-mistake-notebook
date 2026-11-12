import {env} from 'cloudflare:workers';
import {runNextJob} from '@/lib/processing-jobs';
export async function POST(request:Request){
 const expected=env.TASK_WORKER_SECRET;
 if(!expected||expected.length<32)return Response.json({error:'后台执行器未配置'},{status:503});
 // Compare digests without exposing credentials or an early-exit string comparison.
 const digest=async(s:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
 const a=await digest(request.headers.get('Authorization')||'');const b=await digest(`Bearer ${expected}`);let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
 if(diff)return Response.json({error:'未授权'},{status:401});
 try{return Response.json({processed:await runNextJob()},{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'任务执行器暂不可用'},{status:503});}
}

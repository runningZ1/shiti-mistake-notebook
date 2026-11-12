// Run under a process supervisor. Queued work and expired leases survive service restarts.
const endpoint=process.env.TASK_WORKER_URL||'http://127.0.0.1:3105/api/tasks/run';
if(!process.env.TASK_WORKER_SECRET||process.env.TASK_WORKER_SECRET.length<32)throw new Error('TASK_WORKER_SECRET must contain at least 32 characters');
let stopping=false;process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
while(!stopping){
 try{
  const r=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${process.env.TASK_WORKER_SECRET}`},signal:AbortSignal.timeout(9*60_000)});
  if(!r.ok)console.error('任务执行器HTTP状态',r.status);
  else if((await r.json()).processed)continue;
 }catch{console.error('任务执行器连接失败，稍后重试');}
 await new Promise(resolve=>setTimeout(resolve,3000));
}

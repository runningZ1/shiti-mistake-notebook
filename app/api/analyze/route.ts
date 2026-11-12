import {imageStorage,storageConfigured} from '@/lib/storage';
import {ocrConfigured,OcrError,ocrBody} from '@/lib/baidu-ocr';
import {authenticateForAi} from '@/lib/api-guard';
import {query} from '@/db/client';
import {UploadError,imageBase64} from '@/lib/uploads';
import {enqueueJob} from '@/lib/processing-jobs';
import {requireProfile} from '@/lib/profiles';
import {isSameOriginRequest} from '@/lib/auth';
import {isCalendarDate} from '@/lib/mistake-dates';
import {normalizeSubject} from '@/lib/question-types';
export const runtime='edge';
export async function POST(request:Request){
 if(!isSameOriginRequest(request))return Response.json({error:'请求来源不被允许'},{status:403});
 const auth=await authenticateForAi();if('response'in auth)return auth.response;
 if(!storageConfigured()||!ocrConfigured())return Response.json({error:'云存储或百度识别尚未配置'},{status:503});
 let uploadId='',uploadLease='';
 try{
  const p=await requireProfile(auth.user.userId),userId=auth.user.userId;
  const form=await request.formData();const files=form.getAll('files').filter((v):v is File=>v instanceof File);
  const originals=form.getAll('originalFiles').filter((v):v is File=>v instanceof File);
  if(!files.length||files.length>4||originals.length&&originals.length!==files.length)throw new UploadError('请选择1至4张照片',400);
  if([...files,...originals].some(f=>!['image/jpeg','image/png'].includes(f.type)||!f.size||f.size>8*1024*1024))throw new UploadError('仅支持JPG/PNG，每张最多8MB',400);
  const intent=String(form.get('intent')||'marked');if(!['marked','check','collect'].includes(intent))throw new UploadError('上传目的无效',400);
  const title=String(form.get('title')||files.map(f=>f.name).join('、')).trim();const grade=String(form.get('gradeLevel')||'').trim();
  const date=String(form.get('homeworkDate')||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
  if(!isCalendarDate(date)||!title||title.length>200||grade.length>60)throw new UploadError('作业名称、年级或日期无效',400);
  const requestKey=request.headers.get('Idempotency-Key');if(!requestKey||!/^[\w-]{16,100}$/.test(requestKey))throw new UploadError('缺少有效的上传请求标识，请重新选择照片',400);
  const images=await Promise.all(files.map(async f=>{const bytes=new Uint8Array(await f.arrayBuffer());const image={bytes,mime:f.type,base64:imageBase64(bytes)};ocrBody(image);return image;}));
  const originalsBytes=originals.length?await Promise.all(originals.map(async f=>new Uint8Array(await f.arrayBuffer()))):images.map(i=>i.bytes);
  const hashes=await Promise.all(originalsBytes.map(async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(v=>v.toString(16).padStart(2,'0')).join('')));
  const photoHash=hashes.join(':');
  const rotations=JSON.parse(String(form.get('rotations')||JSON.stringify(files.map(()=>0))));if(!Array.isArray(rotations)||rotations.length!==files.length||rotations.some(v=>![0,90,180,270].includes(v)))throw new UploadError('旋转参数无效',400);
  uploadId=crypto.randomUUID();const keys=files.map((_,i)=>`${userId}/${uploadId}/cloud/${i}`);
  const metadata=files.map((f,i)=>({rotation:rotations[i],originalKey:`${userId}/${uploadId}/cloud/original-${i}`,originalName:(originals[i]||f).name,hash:hashes[i]}));
  const inserted=await query<{id:string;profile_id:string;photo_hash:string;file_keys:string[];page_metadata:typeof metadata}>(`INSERT INTO uploads(id,user_id,profile_id,subject,title,grade_level,homework_date,intent,file_keys,file_names,request_key,photo_hash,page_metadata,analysis_status,analysis_error)
   VALUES($1,$2,$3,$4,$5,$6,$7::date,$8,$9::jsonb,$10::jsonb,$11,$12,$13::jsonb,'failed','照片保存中，可用同一请求重试')
   ON CONFLICT(user_id,request_key) WHERE request_key IS NOT NULL DO UPDATE SET request_key=EXCLUDED.request_key RETURNING id,profile_id,photo_hash,file_keys,page_metadata`,[uploadId,userId,p.id,normalizeSubject(String(form.get('subject')||'其他')),title,grade,date,intent,JSON.stringify(keys),JSON.stringify(files.map(f=>f.name)),requestKey,photoHash,JSON.stringify(metadata)]);
  const stored=inserted.rows[0];uploadId=stored.id;
  if(stored.profile_id!==p.id||stored.photo_hash!==photoHash||stored.file_keys.length!==files.length||stored.page_metadata.some((m,i)=>m.rotation!==rotations[i]))throw new UploadError('上传标识已用于其他照片、旋转版本或档案，请重新选择后上传',409);
  const lease=crypto.randomUUID();uploadLease=lease;
  const claim=await query(`UPDATE uploads SET analysis_attempt_id=$4,analysis_started_at=now(),analysis_status='processing' WHERE id=$1 AND user_id=$2 AND profile_id=$3 AND (analysis_attempt_id IS NULL OR analysis_started_at<now()-interval '15 minutes') RETURNING id`,[uploadId,userId,p.id,lease]);
  if(!claim.rowCount)return Response.json({uploadId,inProgress:true},{status:202,headers:{'Cache-Control':'private, no-store'}});
  const duplicates=await query<{id:string}>('SELECT id FROM uploads WHERE user_id=$1 AND profile_id=$2 AND photo_hash=$3 AND id<>$4 ORDER BY created_at DESC LIMIT 1',[userId,p.id,photoHash,uploadId]);
  for(let i=0;i<files.length;i++){
   for(const source of [{key:stored.file_keys[i],bytes:images[i].bytes,mime:files[i].type},{key:stored.page_metadata[i].originalKey,bytes:originalsBytes[i],mime:(originals[i]||files[i]).type}]){
    if(await imageStorage.get(source.key))continue;
    const multipart=await imageStorage.createMultipartUpload(source.key,{httpMetadata:{contentType:source.mime}});
    await query('INSERT INTO upload_objects(key,user_id,profile_id,multipart_id)VALUES($1,$2,$3,$4) ON CONFLICT(key) DO UPDATE SET multipart_id=$4',[source.key,userId,p.id,multipart.uploadId]);
    const part=await multipart.uploadPart(1,source.bytes);await multipart.complete([part]);
    if(!await imageStorage.get(source.key))throw new UploadError(`第${i+1}页保存校验未通过，请重试`,502);
   }
  }
  const job=await enqueueJob(uploadId,userId,p.id,'recognize');
  await query('UPDATE uploads SET analysis_attempt_id=NULL WHERE id=$1 AND analysis_attempt_id=$2',[uploadId,lease]);
  return Response.json({uploadId,job,duplicateOf:duplicates.rows[0]?.id||null},{status:202,headers:{'Cache-Control':'private, no-store'}});
 }catch(e){if(uploadId&&uploadLease)try{await query("UPDATE uploads SET analysis_attempt_id=NULL,analysis_status='failed',analysis_error='照片尚未全部保存，请用同一组照片重试' WHERE id=$1 AND user_id=$2 AND analysis_attempt_id=$3",[uploadId,auth.user.userId,uploadLease]);}catch{/* Retain the lease for recovery when the database is unavailable. */}return Response.json({uploadId:uploadId||undefined,error:e instanceof UploadError||e instanceof OcrError?e.message:'照片处理未完成，已保存的资料保留；请重试'},{status:e instanceof UploadError||e instanceof OcrError?e.status:e instanceof SyntaxError?400:503});}
}

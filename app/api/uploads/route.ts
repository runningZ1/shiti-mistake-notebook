import { authenticate } from "@/lib/api-guard";
import { listUploads } from "@/lib/uploads";
import {isCalendarDate} from '@/lib/mistake-dates';

export async function GET(request: Request) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  const params = new URL(request.url).searchParams;
  const page = Number(params.get("page") || "1"), limit = Number(params.get("limit") || "20");
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isInteger(limit) || limit < 1 || limit > 50) return Response.json({error:"分页参数无效"},{status:400});
  const date=params.get('date')||undefined,homeworkDate=params.get('homeworkDate')||undefined;
  if(date&&!isCalendarDate(date)||homeworkDate&&!isCalendarDate(homeworkDate))return Response.json({error:'日期无效'},{status:400});
  try { return Response.json(await listUploads(auth.user.userId,page,limit,{date,homeworkDate,subject:params.get('subject')||undefined}),{headers:{"Cache-Control":"private, no-store"}}); }
  catch { return Response.json({error:"分析记录加载失败，请重试"},{status:503}); }
}

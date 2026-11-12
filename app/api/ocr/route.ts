import { authenticateForAi } from "@/lib/api-guard";
import { isSameOriginRequest } from "@/lib/auth";
import { recognizePages, ocrConfigured, OcrError } from "@/lib/baidu-ocr";
import { readEssayImages, EssayImageError } from "@/lib/essay-images";

export const runtime = "edge";

/** Standalone OCR for the upcoming integration check. Never calls a language model. */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ error: "请求来源不被允许" }, { status: 403 });
  const auth = await authenticateForAi();
  if ("response" in auth) return auth.response;
  if (!ocrConfigured()) return Response.json({ error: "百度试卷切题识别尚未配置" }, { status: 503 });
  try {
    const images = await readEssayImages(await request.formData());
    return Response.json({ provider: "baidu-paper-cut-edu", pages: await recognizePages(images) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof OcrError || error instanceof EssayImageError ? error.message : "百度 OCR 请求失败，请重试" }, { status: error instanceof OcrError ? error.status : error instanceof EssayImageError ? 400 : 502 });
  }
}

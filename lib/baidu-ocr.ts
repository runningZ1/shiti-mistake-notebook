import { env } from "cloudflare:workers";

export class OcrError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}
type OcrLocation = number[][] | { points: Array<{ x: number; y: number }> };
export type OcrElement = { elem_type: number | string; elem_probability: number; elem_location: OcrLocation; elem_word: Array<{ word: string; word_type: string; word_location: number[][] | { top: number; left: number; width: number; height: number } }> };
export type OcrQuestion = {
  qus_type: number | string; qus_probability: number; qus_location: OcrLocation;
  elem_text?: { stem_text?: string; subqus_text?: string; answer_text?: string; option_text?: string; interpretation_text?: string };
  qus_element: OcrElement[];
};
export type OcrPage = { pageNumber: number; width: number; height: number; result: { log_id: string | number; direction?: number; qus_result_num: number; qus_figure: unknown[]; qus_result: OcrQuestion[] } };
export type OcrImage = { mime: string; base64: string; bytes?: Uint8Array };
let tokenCache: { apiKey: string; secretKey: string; token: string; expires: number } | undefined;
export const ocrConfigured = () => Boolean(env.BAIDU_OCR_API_KEY && env.BAIDU_OCR_SECRET_KEY);

async function token() {
  if (!ocrConfigured()) throw new OcrError("百度试卷切题识别尚未配置", 503);
  if (tokenCache && tokenCache.apiKey === env.BAIDU_OCR_API_KEY && tokenCache.secretKey === env.BAIDU_OCR_SECRET_KEY && tokenCache.expires > Date.now()) return tokenCache.token;
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: env.BAIDU_OCR_API_KEY!, client_secret: env.BAIDU_OCR_SECRET_KEY! });
  const response = await fetch("https://aip.baidubce.com/oauth/2.0/token", { method: "POST", body, redirect: "manual", signal: AbortSignal.timeout(20_000) });
  const result = await response.json() as { access_token?: string; expires_in?: number };
  if (!response.ok || !result.access_token) throw new OcrError("百度 OCR 鉴权失败，请检查 API Key、Secret Key 和服务权限", 503);
  tokenCache = { apiKey: env.BAIDU_OCR_API_KEY!, secretKey: env.BAIDU_OCR_SECRET_KEY!, token: result.access_token, expires: Date.now() + Math.max(0, (result.expires_in || 0) - 60) * 1000 };
  return result.access_token;
}

export function imageSize(image: OcrImage) {
  const bytes = image.bytes || Uint8Array.from(atob(image.base64), c => c.charCodeAt(0));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (image.mime === "image/png" && bytes.length >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) return { width: view.getUint32(16), height: view.getUint32(20) };
  if (image.mime === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216) {
    for (let offset = 2; offset + 9 < bytes.length;) {
      if (bytes[offset] !== 255 || bytes[offset + 1] === 255) { offset++; continue; }
      const marker = bytes[offset + 1];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker >= 0xd0 && marker <= 0xd7) { offset += 2; continue; }
      const length = view.getUint16(offset + 2);
      if (length < 2) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
      offset += 2 + length;
    }
  }
  throw new OcrError("百度试卷切题仅支持有效的 JPG、PNG 图片，请转换图片格式后上传", 400);
}

export function ocrBody(image: OcrImage, language: "CHN_ENG" | "ENG" = "CHN_ENG") {
  const size = imageSize(image);
  if (Math.min(size.width, size.height) < 15 || Math.max(size.width, size.height) > 8192) throw new OcrError("百度 OCR 要求图片边长在 15 至 8192 像素之间", 400);
  // Keep original coordinates: automatic orientation/enhancement can change the coordinate space.
  const body = new URLSearchParams({ image: image.base64, language_type: language, detect_direction: "false", words_type: "handprint_mix", splice_text: "true", enhance: "false", only_split: "false" });
  if (new TextEncoder().encode(body.toString()).byteLength > 10 * 1024 * 1024) throw new OcrError("图片编码后超过百度 OCR 的 10MB 限制，请压缩图片后上传", 413);
  return { body, size };
}

export async function recognizePages(images: OcrImage[], language: "CHN_ENG" | "ENG" = "CHN_ENG"): Promise<OcrPage[]> {
  // Validate every page before making any billable request. Sequential requests respect low QPS quotas.
  const inputs = images.map(image => ocrBody(image, language));
  const pages: OcrPage[] = [];
  for (const [index, input] of inputs.entries()) {
    let result;
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: Response;
      try {
        response = await fetch(`https://aip.baidubce.com/rest/2.0/ocr/v1/paper_cut_edu?access_token=${encodeURIComponent(await token())}`, { method: "POST", body: input.body, redirect: "manual", signal: AbortSignal.timeout(60_000) });
      } catch (error) {
        if (error instanceof OcrError) throw error;
        throw new OcrError(`第 ${index + 1} 页百度 OCR 网络异常或超时，请重试`);
      }
      // log_id is uint64 and may exceed JavaScript's safe integer range.
      result = JSON.parse((await response.text()).replace(/("log_id"\s*:\s*)(\d+)/g, '$1"$2"')) as OcrPage["result"] & { error_code?: number; error_msg?: string };
      if ([110, 111].includes(result.error_code || 0) && attempt === 0) { tokenCache = undefined; continue; }
      if (!response.ok || result.error_code) throw new OcrError(`第 ${index + 1} 页百度 OCR 请求失败（${result.error_code || response.status}），请检查试卷切题权限、额度或图片格式`);
      break;
    }
    if (!result || !Array.isArray(result.qus_result) || !result.qus_result.length || result.qus_result_num !== result.qus_result.length || result.qus_result.some(q => !Array.isArray(q.qus_element))) throw new OcrError(`第 ${index + 1} 页未返回完整题目，请上传正向、清晰的照片`, 422);
    pages.push({ pageNumber: index + 1, ...input.size, result });
  }
  return pages;
}

export function questionText(question: OcrQuestion, types = [0, 1, 3]) {
  return question.qus_element.filter(element => types.includes(Number(element.elem_type))).map(element => element.elem_word.map(word => word.word).join("\n")).filter(Boolean).join("\n");
}

export function questionBounds(page: OcrPage, question: OcrQuestion): number[] {
  if (page.result.direction) return [];
  const location = question.qus_location;
  const points = Array.isArray(location) ? location : location?.points?.map(point => [point.x, point.y]);
  if (!Array.isArray(points) || points.length !== 4 || points.some(p => !Array.isArray(p) || p.length !== 2 || p.some(v => !Number.isFinite(v)))) return [];
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const box = [Math.floor(Math.min(...xs) / page.width * 1000), Math.floor(Math.min(...ys) / page.height * 1000), Math.ceil(Math.max(...xs) / page.width * 1000), Math.ceil(Math.max(...ys) / page.height * 1000)].map(v => Math.max(0, Math.min(1000, v)));
  return box[0] < box[2] && box[1] < box[3] ? box : [];
}

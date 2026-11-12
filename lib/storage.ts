import { env } from "cloudflare:workers";
import { AwsClient } from "aws4fetch";
import { XMLParser } from "fast-xml-parser";

const xml = new XMLParser({ parseTagValue: false, processEntities: true });
const cloudKey = (key: string) => /^[^/]+\/[^/]+\/cloud\//.test(key);
export function storageConfigured() {
  return Boolean(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET_NAME);
}

function legacy() {
  if (!env.BUCKET) throw new Error("历史图片存储不可用");
  return env.BUCKET;
}

async function send(key: string, method: string, params: Record<string, string> = {}, body?: BodyInit, headers?: HeadersInit) {
  if (!storageConfigured()) throw new Error("Cloudflare R2 云存储尚未配置");
  const endpoint = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const url = new URL(`${endpoint}/${encodeURIComponent(env.R2_BUCKET_NAME!)}/${key.split("/").map(encodeURIComponent).join("/")}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  const client = new AwsClient({ accessKeyId: env["R2_ACCESS_KEY_ID"]!, secretAccessKey: env["R2_SECRET_ACCESS_KEY"]!, service: "s3", region: "auto", retries: 0 });
  // Sign first, then use Workers fetch explicitly with a bounded timeout and no redirects.
  const signed = await client.sign(url.toString(), { method, body, headers });
  const response = await fetch(signed, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    const error = xml.parse(await response.text())?.Error;
    if (method === "GET" && response.status === 404 && error?.Code === "NoSuchKey") return null;
    if (method === "DELETE" && error?.Code === "NoSuchUpload") return response;
    throw new Error(`R2 ${method} 失败（${response.status}，${String(error?.Code || "upstream_error").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 80)}）`);
  }
  return response;
}

function multipart(key: string, uploadId: string) {
  return {
    key, uploadId,
    async uploadPart(partNumber: number, bytes: Uint8Array) {
      const response = await send(key, "PUT", { uploadId, partNumber: String(partNumber) }, bytes as BodyInit);
      const etag = response?.headers.get("etag");
      if (!etag) throw new Error("R2 未返回上传校验标识");
      return { partNumber, etag };
    },
    async complete(parts: R2UploadedPart[]) {
      const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      const body = `<CompleteMultipartUpload>${parts.map(part => `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${escape(part.etag)}</ETag></Part>`).join("")}</CompleteMultipartUpload>`;
      const response = await send(key, "POST", { uploadId }, body, { "Content-Type": "application/xml" });
      const result = xml.parse(await response!.text());
      if (result.Error || !result.CompleteMultipartUploadResult?.ETag) throw new Error("R2 完成上传失败");
    },
    async abort() { await send(key, "DELETE", { uploadId }); },
  };
}

/** New objects always use remote R2. Old keys keep their original local binding. */
export const imageStorage = {
  async createMultipartUpload(key: string, options: { httpMetadata: { contentType: string } }) {
    if (!cloudKey(key)) throw new Error("新图片必须使用云存储对象键");
    const response = await send(key, "POST", { uploads: "" }, undefined, { "Content-Type": options.httpMetadata.contentType });
    const id = xml.parse(await response!.text())?.InitiateMultipartUploadResult?.UploadId;
    if (typeof id !== "string" || !id) throw new Error("R2 初始化上传失败");
    return multipart(key, id);
  },
  resumeMultipartUpload(key: string, id: string) {
    return cloudKey(key) ? multipart(key, id) : legacy().resumeMultipartUpload(key, id);
  },
  async get(key: string) {
    if (!cloudKey(key)) return legacy().get(key);
    const response = await send(key, "GET");
    if (!response) return null;
    return { body: response.body, httpMetadata: { contentType: response.headers.get("content-type") || "" }, arrayBuffer: () => response.arrayBuffer() };
  },
  async delete(keys: string | string[]) {
    // Keep partial failures visible so the existing database indexes remain retryable.
    for (const key of typeof keys === "string" ? [keys] : keys) {
      if (cloudKey(key)) await send(key, "DELETE");
      else await legacy().delete(key);
    }
  },
};

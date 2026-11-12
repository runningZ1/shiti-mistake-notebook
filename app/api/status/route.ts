import { aiConfigured } from "@/lib/ai";
import { ocrConfigured } from "@/lib/baidu-ocr";
import { storageConfigured } from "@/lib/storage";
export async function GET() { return Response.json({ aiConfigured: aiConfigured(), ocrConfigured: ocrConfigured(), storageConfigured: storageConfigured() }, { headers: { "Cache-Control": "no-store" } }); }

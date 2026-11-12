export type MistakePrintOptions = {
  template: "worksheet" | "paste";
  fontSize: 12 | 14;
  reflectionMode: "saved-or-blank" | "blank" | "saved-plus-blank";
  includeAnswers: boolean;
  includeSimilar: boolean;
  /** Physical width, independent of the text font size. Optional for older callers. */
  imageWidthMm?: number;
};

export const pastePrintOptions: MistakePrintOptions = {
  template: "paste", fontSize: 12, reflectionMode: "saved-or-blank", includeAnswers: true, includeSimilar: false, imageWidthMm: 160,
};
export const worksheetPrintOptions: MistakePrintOptions = {
  template: "worksheet", fontSize: 12, reflectionMode: "saved-or-blank", includeAnswers: true, includeSimilar: true, imageWidthMm: 160,
};

export function printOptionsParams(options: MistakePrintOptions): URLSearchParams {
  return new URLSearchParams({
    template: options.template, fontSize: String(options.fontSize), reflectionMode: options.reflectionMode,
    includeAnswers: options.includeAnswers ? "1" : "0", includeSimilar: options.includeSimilar ? "1" : "0",
    imageWidthMm: String(options.imageWidthMm ?? 160),
  });
}

/** No print parameters preserves the original worksheet contract. Invalid or duplicate options are rejected. */
export function parseMistakePrintOptions(params: URLSearchParams): MistakePrintOptions | undefined {
  const keys = ["template", "fontSize", "reflectionMode", "includeAnswers", "includeSimilar", "imageWidthMm"];
  if (!keys.some(key => params.has(key))) return undefined;
  if (keys.some(key => params.getAll(key).length > 1)) throw new Error("打印设置重复，请重新选择");
  const template = params.get("template") ?? "worksheet";
  const fontSize = params.get("fontSize");
  const reflectionMode = params.get("reflectionMode");
  const includeAnswers = params.get("includeAnswers");
  const includeSimilar = params.get("includeSimilar");
  const width = params.get("imageWidthMm");
  if ((template !== "worksheet" && template !== "paste") ||
    (fontSize !== null && fontSize !== "12" && fontSize !== "14") ||
    (reflectionMode !== null && !["saved-or-blank", "blank", "saved-plus-blank"].includes(reflectionMode)) ||
    (includeAnswers !== null && includeAnswers !== "0" && includeAnswers !== "1") ||
    (includeSimilar !== null && includeSimilar !== "0" && includeSimilar !== "1") ||
    (width !== null && (!/^\d+(\.\d)?$/.test(width) || Number(width) < 60 || Number(width) > 165))) {
    throw new Error("打印设置无效，请重新选择");
  }
  const defaults = template === "paste" ? pastePrintOptions : worksheetPrintOptions;
  return {
    ...defaults, template,
    fontSize: fontSize === null ? defaults.fontSize : fontSize === "14" ? 14 : 12,
    reflectionMode: reflectionMode === null ? defaults.reflectionMode : reflectionMode as MistakePrintOptions["reflectionMode"],
    includeAnswers: includeAnswers === null ? defaults.includeAnswers : includeAnswers === "1",
    includeSimilar: includeSimilar === null ? defaults.includeSimilar : includeSimilar === "1",
    imageWidthMm: width === null ? 160 : Number(width),
  };
}

// A4 210 × 297, margins 20 mm. Reserve room for a repeated heading and paragraph metrics.
export const printGeometry = { pageWidthMm: 210, pageHeightMm: 297, marginMm: 20, segmentHeightMm: 220 } as const;
export type PrintImageSegment = { widthMm: number; heightMm: number; top: number; bottom: number };
/** Question bounds use thousandths of the original image; already-cropped images pass no bounds. */
export function printImageRegion(width: number, height: number, bounds?: number[]) {
  const valid = bounds?.length === 4 && bounds.every(Number.isInteger) &&
    bounds[0] >= 0 && bounds[1] >= 0 && bounds[2] <= 1000 && bounds[3] <= 1000 && bounds[2] > bounds[0] && bounds[3] > bounds[1];
  // Same 12/1000 safety border as the existing browser crop; do not cut touching glyphs.
  const [left, top, right, bottom] = valid ? [Math.max(0, bounds[0] - 12), Math.max(0, bounds[1] - 12), Math.min(1000, bounds[2] + 12), Math.min(1000, bounds[3] + 12)] : [0, 0, 1000, 1000];
  return { width: width * (right - left) / 1000, height: height * (bottom - top) / 1000,
    left: Math.round(left * 100), top: Math.round(top * 100), right: Math.round((1000 - right) * 100), bottom: Math.round((1000 - bottom) * 100) };
}

/** Shared source requirement for caller/export preparation, including manually archived image-only questions. */
export function requiresPrintImage(item: { subject: string; question: string; visualQuestion?: boolean; questionBounds?: number[]; archiveKind?: "mistake" | "collection"; judgementSource?: string }): boolean {
  return item.archiveKind === "collection" || item.judgementSource === "manual" || Boolean(item.visualQuestion) || item.subject.includes("数学") || /原图题目|见题图|(?:如|见|下|右|左).{0,4}[图表]|图(?:形|像|象|表|示)|统计图|坐标系|计算|求值|化简|解方程|作图/.test(item.question);
}
/** Crop values are OOXML percentages (100000 = full source), rounded at shared boundaries. */
export function printImageSegments(width: number, height: number, options?: MistakePrintOptions): PrintImageSegment[] {
  const widthMm = options?.imageWidthMm ?? 160;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 ||
      !Number.isFinite(widthMm) || widthMm < 60 || widthMm > 165) throw new Error("打印图片尺寸无效");
  const totalHeight = height / width * widthMm;
  const count = Math.ceil(totalHeight / printGeometry.segmentHeightMm);
  if (count > 500) throw new Error("原题图片过长，请先分开整理");
  const boundaries = Array.from({ length: count + 1 }, (_, i) => Math.round(Math.min(1, i * printGeometry.segmentHeightMm / totalHeight) * 100000));
  return boundaries.slice(0, -1).map((top, i) => ({
    widthMm, heightMm: totalHeight * (boundaries[i + 1] - top) / 100000,
    top, bottom: 100000 - boundaries[i + 1],
  }));
}

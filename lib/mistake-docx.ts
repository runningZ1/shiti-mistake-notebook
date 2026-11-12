/** Editable Word worksheet. Uses standard OOXML and an uncompressed ZIP, with no network or runtime dependencies. */
import { parseMath, splitMathText, type MathNode } from "./math-notation";
import { kindForQuestion, practiceFormatLabels, practiceKindLabels, type PracticeQuestionFormat, type PracticeQuestionKind } from "./practice-blueprint";
import { parseMistakePrintOptions, printOptionsParams, printImageRegion, printImageSegments, type MistakePrintOptions } from "./mistake-print-options";
export type WorksheetMistake = {
  subject: string;
  question: string;
  incorrectAnswer: string;
  correctAnswer: string;
  reasoning: string;
  reflection?: string;
  knowledgePoint: string;
  pageNumber: number;
  sourceName: string;
  createdAt: string;
  similarQuestions: { question: string; answer: string; explanation: string }[];
  questionBounds?: number[];
  visualQuestion?: boolean;
  archiveKind?: "mistake" | "collection";
  judgementSource?: string;
  sourceImage?: { bytes: Uint8Array; width: number; height: number; fullPage: boolean; mime?: "image/jpeg" | "image/png" };
};

const encoder = new TextEncoder();
const escapeXml = (value: string) =>
  value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

function mathXml(node: MathNode): string {
  switch (node.kind) {
    case "row": return node.children.map(mathXml).join("");
    case "symbol": return `<m:r><m:t xml:space="preserve">${escapeXml(node.value)}</m:t></m:r>`;
    case "sqrt": return `<m:rad><m:radPr><m:degHide m:val="${node.degree ? "0" : "1"}"/></m:radPr><m:deg>${node.degree ? mathXml(node.degree) : ""}</m:deg><m:e>${mathXml(node.body)}</m:e></m:rad>`;
    case "fraction": return `<m:f><m:num>${mathXml(node.numerator)}</m:num><m:den>${mathXml(node.denominator)}</m:den></m:f>`;
    case "sup": return `<m:sSup><m:e>${mathXml(node.base)}</m:e><m:sup>${mathXml(node.script)}</m:sup></m:sSup>`;
    case "sub": return `<m:sSub><m:e>${mathXml(node.base)}</m:e><m:sub>${mathXml(node.script)}</m:sub></m:sSub>`;
  }
}

function paragraphContent(line: string): string {
  return splitMathText(line).map(part => part.kind === "math"
    ? `<m:oMath>${mathXml(parseMath(part.value))}</m:oMath>`
    : `<w:r><w:t xml:space="preserve">${escapeXml(part.value)}</w:t></w:r>`).join("") || "<w:r><w:t> </w:t></w:r>";
}

function paragraphs(value: string, style = "Normal"): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(
      (line) =>
        `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${paragraphContent(line)}</w:p>`,
    )
    .join("");
}
function writingSpace(lines = 2): string {
  return Array.from(
    { length: lines },
    () =>
      '<w:p><w:pPr><w:spacing w:after="40" w:line="300" w:lineRule="auto"/><w:pBdr><w:bottom w:val="single" w:sz="4" w:color="D9D9D9"/></w:pBdr></w:pPr><w:r><w:t> </w:t></w:r></w:p>',
  ).join("");
}
function wordTable(headers: string[], rows: string[][]): string {
  const width = Math.floor(8000 / headers.length);
  const cell = (value: string) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:tcMar><w:top w:w="80" w:type="dxa"/><w:left w:w="110" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="110" w:type="dxa"/></w:tcMar><w:vAlign w:val="center"/></w:tcPr><w:p>${paragraphContent(value)}</w:p></w:tc>`;
  const row = (values: string[]) => `<w:tr>${values.map(cell).join("")}</w:tr>`;
  const border = '<w:top w:val="single" w:sz="4" w:color="D9D9D9"/><w:left w:val="single" w:sz="4" w:color="D9D9D9"/><w:bottom w:val="single" w:sz="4" w:color="D9D9D9"/><w:right w:val="single" w:sz="4" w:color="D9D9D9"/><w:insideH w:val="single" w:sz="4" w:color="D9D9D9"/><w:insideV w:val="single" w:sz="4" w:color="D9D9D9"/>';
  return `<w:tbl><w:tblPr><w:tblW w:w="8000" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${border}</w:tblBorders></w:tblPr><w:tblGrid>${headers.map(() => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>${row(headers)}${rows.map(row).join("")}</w:tbl>`;
}
const ns =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
const xml = (value: string) =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + value;

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** ZIP store method keeps the generator small and is supported by Word/WPS. */
function zip(entries: [string, string | Uint8Array][]): Uint8Array<ArrayBuffer> {
  const files: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  let directorySize = 0;
  for (const [path, content] of entries) {
    const name = encoder.encode(path);
    const data = typeof content === "string" ? encoder.encode(content) : content;
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0x0800, true);
    l.setUint16(12, 33, true); // 1980-01-01, valid DOS date
    l.setUint32(14, crc, true);
    l.setUint32(18, data.length, true);
    l.setUint32(22, data.length, true);
    l.setUint16(26, name.length, true);
    local.set(name, 30);
    files.push(local, data);
    const central = new Uint8Array(46 + name.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(14, 33, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.set(name, 46);
    directory.push(central);
    directorySize += central.length;
    offset += local.length + data.length;
  }
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true);
  e.setUint32(12, directorySize, true);
  e.setUint32(16, offset, true);
  const result = new Uint8Array(offset + directorySize + end.length);
  let cursor = 0;
  for (const chunk of [...files, ...directory, end]) {
    result.set(chunk, cursor);
    cursor += chunk.length;
  }
  return result;
}

function sourceDrawing(index: number, image: NonNullable<WorksheetMistake["sourceImage"]>, _visual: boolean, options?: MistakePrintOptions, bounds?: number[]): string {
  const region = printImageRegion(image.width, image.height, image.fullPage ? bounds : undefined);
  const segments = printImageSegments(region.width, region.height, options);
  return segments.map((segment, part) => {
    const cx = Math.round(segment.widthMm * 36000);
    const cy = Math.round(segment.heightMm * 36000);
    const top = Math.round(region.top + (100000 - region.top - region.bottom) * segment.top / 100000);
    const bottom = Math.round(region.bottom + (100000 - region.top - region.bottom) * segment.bottom / 100000);
    // One relationship/media object per original image. Each drawing clips a contiguous portion.
    const drawingId = index * 1000 + part;
    const page = segments.length > 1
      ? `<w:p><w:pPr><w:pageBreakBefore/><w:spacing w:after="40"/></w:pPr><w:r><w:t>第 ${index} 题 · 原题图片 ${part + 1}/${segments.length} · ${segment.widthMm} mm 宽</w:t></w:r></w:p>` : "";
    return page + `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:drawing>` +
      `<wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">` +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${drawingId}" name="原题图片 ${index} 分段 ${part + 1}"/>` +
      `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
      `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${drawingId}" name="question-${index}.${image.mime === "image/png" ? "png" : "jpg"}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="rIdImage${index}"/><a:srcRect l="${region.left}" t="${top}" r="${region.right}" b="${bottom}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
      `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  }).join("");
}

function recordedDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

function reflectionBlock(item: WorksheetMistake, options: MistakePrintOptions): string {
  const saved = options.reflectionMode !== "blank" ? (item.reflection ?? "").trim() : "";
  const blank = !saved || options.reflectionMode === "saved-plus-blank";
  // Reflection is literal student text, never parsed as mathematical notation or replaced by AI reasoning.
  const text = saved.replace(/\r\n?/g, "\n").split("\n").map(line =>
    `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`).join("");
  const lines = blank ? Array.from({ length: 3 }, () =>
    '<w:p><w:pPr><w:spacing w:after="0" w:line="480" w:lineRule="exact"/><w:pBdr><w:bottom w:val="single" w:sz="4" w:color="D9D9D9"/></w:pBdr></w:pPr><w:r><w:t> </w:t></w:r></w:p>').join("") : "";
  return paragraphs("我的错因", "Heading2") + (saved ? text : "") + lines;
}

function pasteQuestion(item: WorksheetMistake, index: number, options: MistakePrintOptions): string {
  const image = item.sourceImage;
  const imageRegion = image ? printImageRegion(image.width, image.height, image.fullPage ? item.questionBounds : undefined) : null;
  const wholePage = image?.fullPage && imageRegion?.left === 0 && imageRegion?.right === 0 && imageRegion?.top === 0 && imageRegion?.bottom === 0;
  const imageNote = image ? paragraphs(wholePage
    ? "原题整页图片：未裁剪，请核对原题题号；原图中的答案、笔迹和批注可能一并打印。"
    : "原题区域图片：保留该区域原有答案、笔迹和批注，请核对题目完整性。", "Subtitle") : "";
  const content = [
    paragraphs(item.question), imageNote,
    ...(image ? [sourceDrawing(index + 1, image, Boolean(item.visualQuestion), options, item.questionBounds)] : []),
    paragraphs(`来源：${item.sourceName || "未记录来源"} · 原资料第 ${item.pageNumber} 页`, "Subtitle"),
    reflectionBlock(item, options),
    ...(options.includeSimilar ? item.similarQuestions.flatMap((similar, similarIndex) => [
      paragraphs(`第 ${index + 1} 题 · 举一反三 ${similarIndex + 1}`, "Heading2"),
      paragraphs(similar.question), writingSpace(2),
    ]) : []),
  ].join("");
  // Conservatively keep compact text-only questions together. Long rows may flow, with the question number repeated.
  const textParts = [item.question, options.reflectionMode === "blank" ? "" : item.reflection ?? "", item.sourceName];
  const lineCount = textParts.reduce((sum, text) => sum + text.split("\n").reduce((lines, line) => lines + Math.max(1, Math.ceil([...line].length / 28)), 0), 0);
  const short = !image && (!options.includeSimilar || !item.similarQuestions.length) && lineCount <= 10;
  const title = `第 ${index + 1} 题 · ${item.subject} · 整理日期（北京时间）：${recordedDate(item.createdAt) || "未记录"}`;
  const region = image ? printImageRegion(image.width, image.height, image.fullPage ? item.questionBounds : undefined) : null;
  if (region && printImageSegments(region.width, region.height, options).length > 1) {
    return paragraphs(title, "Heading1") + content +
      '<w:p><w:pPr><w:spacing w:before="150" w:after="150"/><w:pBdr><w:bottom w:val="dashed" w:sz="4" w:color="CCCCCC"/></w:pBdr></w:pPr><w:r><w:t>裁剪线</w:t></w:r></w:p>';
  }
  return `<w:tbl><w:tblPr><w:tblW w:w="9638" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="40" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="40" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="9638"/></w:tblGrid>` +
    `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="9638" w:type="dxa"/></w:tcPr>${paragraphs(title, "Heading1")}</w:tc></w:tr>` +
    `<w:tr><w:trPr>${short ? "<w:cantSplit/>" : ""}</w:trPr><w:tc><w:tcPr><w:tcW w:w="9638" w:type="dxa"/></w:tcPr>${content}</w:tc></w:tr></w:tbl>` +
    '<w:p><w:pPr><w:spacing w:before="150" w:after="150"/><w:pBdr><w:bottom w:val="dashed" w:sz="4" w:color="CCCCCC"/></w:pBdr></w:pPr><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="888888"/></w:rPr><w:t>裁剪线</w:t></w:r></w:p>';
}

export function makeMistakeDocx(
  item: WorksheetMistake,
  options?: MistakePrintOptions,
): Uint8Array<ArrayBuffer> {
  return makeMistakesDocx([item], options);
}

/** One editable worksheet for the selected mistakes, with one shared answer section. */
export function makeMistakesDocx(items: WorksheetMistake[], options?: MistakePrintOptions): Uint8Array<ArrayBuffer> {
  if (!items.length) throw new Error("请先选择错题");
  if (options) options = parseMistakePrintOptions(printOptionsParams(options));
  items.forEach((item, index) => {
    const image = item.sourceImage;
    if (!image && (item.archiveKind === "collection" || item.judgementSource === "manual" || item.visualQuestion || /原图题目|见题图/.test(item.question))) {
      throw new Error(`第 ${index + 1} 题必须保留原题图片，请读取原图后再导出`);
    }
    if (image && (!image.bytes.length || !Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width <= 0 || image.height <= 0)) {
      throw new Error(`第 ${index + 1} 题原图不可读，请重新加载后重试`);
    }
  });
  const paste = options?.template === "paste";
  const includeAnswers = options?.includeAnswers ?? true;
  const includeSimilar = options?.includeSimilar ?? true;
  const single = items.length === 1;
  const first = items[0];
  const parsedDate = new Date(first.createdAt);
  const recorded = options ? recordedDate(first.createdAt) : Number.isNaN(parsedDate.getTime()) ? "" : parsedDate.toLocaleDateString("zh-CN");
  const body = [
    paragraphs(paste ? `错题本剪贴版 · ${items.length} 道` : single ? "错题练习单" : `错题练习单 · ${items.length} 道`, "Title"),
    paragraphs(paste ? "A4纵向 · 20mm页边距 · 版式示意，实际分页以Word/WPS为准。长题跨页时重复题号栏。" :
      single ? [first.subject, first.knowledgePoint, recorded].filter(Boolean).join(" · ") : `${items.length} 道错题 · 题目与答案分开`, "Subtitle"),
    ...(paste ? [] : [paragraphs("姓名：________________    日期：________________", "Subtitle")]),
    ...(paste && options ? items.map((item, index) => pasteQuestion(item, index, options)) : items.flatMap((item, itemIndex) => [
      paragraphs(single ? "一、原题" : `第 ${itemIndex + 1} 道错题 · ${item.subject} · ${item.knowledgePoint || "未标注知识点"}`, "Heading1"),
      paragraphs(item.question),
      ...(item.sourceImage ? [
        paragraphs(item.sourceImage.fullPage && !item.questionBounds?.length ? "原题整页图片（旧题未记录裁剪区域，请核对题号）" : "原题图片（含公式或图表）", "Subtitle"),
        sourceDrawing(itemIndex + 1, item.sourceImage, Boolean(item.visualQuestion), options, item.questionBounds),
      ] : []),
      ...(item.sourceName ? [paragraphs(`来源：${item.sourceName} · 第 ${item.pageNumber} 页`, "Subtitle")] : []),
      writingSpace(2),
      ...(options ? [reflectionBlock(item, options)] : []),
      ...(includeSimilar && item.similarQuestions.length ? [
        paragraphs(single ? "二、举一反三" : "举一反三", "Heading1"),
        ...item.similarQuestions.flatMap((similar, index) => [
          paragraphs(`练习 ${index + 1}`, "Heading2"),
          paragraphs(similar.question),
          writingSpace(2),
        ]),
      ] : []),
    ])),
    ...(includeAnswers ? ['<w:p><w:r><w:br w:type="page"/></w:r></w:p>',
    paragraphs("参考答案与解析", "Title"),
    paragraphs("完成练习后再核对答案。", "Subtitle"),
    ...items.flatMap((item, itemIndex) => [
      paragraphs(single ? "原题解析" : `第 ${itemIndex + 1} 道错题 · ${item.subject} · ${item.knowledgePoint || "未标注知识点"}`, "Heading1"),
      paragraphs(`我的原答案：${item.incorrectAnswer || "未记录"}`),
      paragraphs(`正确答案：${item.correctAnswer}`),
      paragraphs(`解题思路：${item.reasoning || "未记录"}`),
      ...(includeSimilar ? item.similarQuestions : []).flatMap((similar, index) => [
        paragraphs(`练习 ${index + 1}`, "Heading2"),
        paragraphs(`答案：${similar.answer}`),
        paragraphs(`解析：${similar.explanation || "未记录"}`),
      ]),
    ]),] : []),
    '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567"/><w:pgNumType w:start="1"/></w:sectPr>',
  ].join("");
  const styles = `<w:styles ${ns}>
    <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="宋体"/><w:sz w:val="${options ? options.fontSize * 2 : 21}"/><w:szCs w:val="${options ? options.fontSize * 2 : 21}"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="90" w:line="300" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults>
    <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
    <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="100" w:after="130"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="666666"/><w:sz w:val="${options ? options.fontSize * 2 : 21}"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="0"/><w:spacing w:before="170" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="${options ? options.fontSize * 2 : 25}"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="1"/><w:spacing w:before="110" w:after="50"/></w:pPr><w:rPr><w:b/><w:sz w:val="${options ? options.fontSize * 2 : 22}"/></w:rPr></w:style>
    </w:styles>`;
  const media = new Map<Uint8Array, string>();
  const imageTargets = items.map((item, index) => {
    if (!item.sourceImage) return "";
    const prior = media.get(item.sourceImage.bytes);
    if (prior) return prior;
    const target = `media/question-${index + 1}.${item.sourceImage.mime === "image/png" ? "png" : "jpg"}`;
    media.set(item.sourceImage.bytes, target);
    return target;
  });
  return zip([
    [
      "[Content_Types].xml",
      xml(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>',
      ),
    ],
    [
      "_rels/.rels",
      xml(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
    ],
    [
      "word/document.xml",
      xml(`<w:document ${ns}><w:body>${body}</w:body></w:document>`),
    ],
    ["word/styles.xml", xml(styles)],
    [
      "word/_rels/document.xml.rels",
      xml(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>${imageTargets.map((target, index) => target ? `<Relationship Id="rIdImage${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/>` : "").join("")}</Relationships>`,
      ),
    ],
    [
      "word/footer1.xml",
      xml(
        `<w:ftr ${ns}><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="18"/><w:color w:val="777777"/></w:rPr><w:t xml:space="preserve">拾题 · 第 </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple><w:r><w:t xml:space="preserve"> 页</w:t></w:r></w:p></w:ftr>`,
      ),
    ],
    ...[...media].map(([bytes, target]): [string, Uint8Array] => [`word/${target}`, bytes]),
  ]);
}

export function mistakeDocxFilename(item: WorksheetMistake, options?: MistakePrintOptions): string {
  if (options) return mistakesDocxFilename([item], options);
  const title = ["拾题", item.subject, item.knowledgePoint || "错题练习"].join(
    "-",
  );
  return (
    title
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .slice(0, 90)
      .trim() + ".docx"
  );
}

export function mistakesDocxFilename(items: WorksheetMistake[], options?: MistakePrintOptions): string {
  if (!items.length) throw new Error("请先选择错题");
  if (options) options = parseMistakePrintOptions(printOptionsParams(options));
  if (options) {
    const dates = items.map(item => recordedDate(item.createdAt)).filter(Boolean).sort();
    const range = !dates.length ? "日期未记录" : dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]}至${dates[dates.length - 1]}`;
    return `拾题-${range}-${items.length}道错题${options.template === "paste" ? "剪贴版" : "练习单"}.docx`;
  }
  if (items.length === 1) return mistakeDocxFilename(items[0]);
  const subject = items.every(item => item.subject === items[0].subject) ? items[0].subject : "综合";
  return `拾题-${subject}-${items.length}道错题练习`
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 90).trim() + ".docx";
}

export type UnitWorksheet = {
  subject: string;
  unitName: string;
  gradeLevel: string;
  questions: { question: string; answer: string; explanation: string; knowledgePoint: string; kind?: PracticeQuestionKind; format?: PracticeQuestionFormat; options?: string[]; table?: { headers: string[]; rows: string[][] } }[];
};

/** A4 editable worksheet; answers start on a separate page. */
export function makeUnitPaperDocx(paper: UnitWorksheet): Uint8Array<ArrayBuffer> {
  if (paper.questions.some(item => !item.question.trim() || (item.format === "chart" && (!item.table?.headers.length || !item.table.rows.length)))) {
    throw new Error("题目或图表数据不完整，无法导出完整试卷");
  }
  const title = `${paper.subject} · ${paper.unitName}单元练习卷`;
  const body = [
    paragraphs(title, "Title"),
    paragraphs([paper.gradeLevel, `${paper.questions.length} 道题`].filter(Boolean).join(" · "), "Subtitle"),
    paragraphs("姓名：________________    日期：________________    得分：________", "Subtitle"),
    paragraphs("请独立完成练习，答案和解析在文档后半部分。", "Normal"),
    ...paper.questions.flatMap((item, index) => [
      paragraphs(`${index + 1}. 【${item.format ? practiceFormatLabels[item.format] + " · " : ""}${practiceKindLabels[kindForQuestion(item.kind)]}】${item.question}`, "Question"),
      ...(item.format === "chart" && item.table?.headers.length && item.table.rows.length ? [wordTable(item.table.headers, item.table.rows)] : []),
      ...(item.format === "choice" && item.options?.length === 4 ? item.options.map((option, optionIndex) => paragraphs(`${"ABCD"[optionIndex]}. ${option}`)) : []),
      writingSpace(item.format === "choice" ? 0 : item.format === "fill" ? 1 : 2),
    ]),
    '<w:p><w:r><w:br w:type="page"/></w:r></w:p>',
    paragraphs("参考答案与解析", "Title"),
    ...paper.questions.flatMap((item, index) => [
      paragraphs(`${index + 1}. ${practiceKindLabels[kindForQuestion(item.kind)]} · ${item.knowledgePoint}`, "Question"),
      paragraphs(`答案：${item.answer}`),
      paragraphs(`解析：${item.explanation}`),
    ]),
    '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:header="567" w:footer="567"/></w:sectPr>',
  ].join("");
  const styles = `<w:styles ${ns}>
    <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="宋体"/><w:sz w:val="21"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="90" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
    <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
    <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="100" w:after="130"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="666666"/><w:sz w:val="21"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="Question"><w:name w:val="Question"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="70"/></w:pPr><w:rPr><w:b/><w:sz w:val="23"/></w:rPr></w:style>
    </w:styles>`;
  return zip([
    ["[Content_Types].xml", xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>')],
    ["_rels/.rels", xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')],
    ["word/document.xml", xml(`<w:document ${ns}><w:body>${body}</w:body></w:document>`)],
    ["word/styles.xml", xml(styles)],
    ["word/_rels/document.xml.rels", xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>')],
    ["word/footer1.xml", xml(`<w:ftr ${ns}><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>拾题 · 第 </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple><w:r><w:t> 页</w:t></w:r></w:p></w:ftr>`) ],
  ]);
}

export function unitPaperDocxFilename(paper: Pick<UnitWorksheet, "subject" | "unitName">): string {
  return `拾题-${paper.subject}-${paper.unitName}-单元练习卷`
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 90).trim() + ".docx";
}

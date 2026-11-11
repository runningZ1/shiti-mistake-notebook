// Independently validate generated Word packages with Python's ZIP/XML readers.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(
  new URL("../lib/mistake-docx.ts", import.meta.url),
  "utf8",
);
const code = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;
const mathCode = ts.transpileModule(readFileSync(new URL("../lib/math-notation.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const mathExports = {};
vm.runInNewContext(mathCode, { exports: mathExports });
const blueprintCode = ts.transpileModule(readFileSync(new URL("../lib/practice-blueprint.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const blueprintExports = {};
vm.runInNewContext(blueprintCode, { exports: blueprintExports });
const printCode = ts.transpileModule(readFileSync(new URL("../lib/mistake-print-options.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const printExports = {};
vm.runInNewContext(printCode, { exports: printExports, URLSearchParams });
const { pastePrintOptions, worksheetPrintOptions, printOptionsParams, parseMistakePrintOptions } = printExports;
for (const options of [pastePrintOptions, { ...worksheetPrintOptions, fontSize: 14, includeAnswers: false, includeSimilar: false, reflectionMode: "blank" }]) {
  assert.deepEqual(JSON.parse(JSON.stringify(parseMistakePrintOptions(printOptionsParams(options)))), JSON.parse(JSON.stringify(options)));
}
for (const query of ["template=unknown", "fontSize=13", "reflectionMode=ai", "includeAnswers=true", "includeSimilar=2", "template=paste&template=worksheet"]) {
  assert.throws(() => parseMistakePrintOptions(new URLSearchParams(query)), /打印设置/);
}
const exports = {};
vm.runInNewContext(code, { exports, require: name => {
  if (name === "./math-notation") return mathExports;
  if (name === "./practice-blueprint") return blueprintExports;
  throw new Error(`Unexpected import: ${name}`);
}, TextEncoder, Uint8Array, DataView, Date });
const fixture = {
  subject: "数学",
  question: "计算：(-3)² + 2 × (-4)\n判断：3 < 5 & 8 > 2。\u0000\n再求 √(9) 和 1/2。",
  incorrectAnswer: "-17",
  correctAnswer: "1",
  reasoning: "先算乘方，再算乘除，最后加减。\n保留换行。",
  knowledgePoint: "有理数混合运算",
  pageNumber: 2,
  sourceName: "周练 & <练习>.png",
  createdAt: "2026-10-18T00:00:00Z",
  similarQuestions: [
    {
      question: "求 (-2)³ + 4 × 3 的值。",
      answer: "4",
      explanation: "-8 + 12 = 4。",
    },
    {
      question: "This is a long English question. ".repeat(50),
      answer: "English answer",
      explanation: "Explanation.",
    },
  ],
};
mkdirSync(new URL("../outputs/", import.meta.url), { recursive: true });
const files = ["mistake-worksheet.docx", "mistake-no-practice.docx"];
for (const [index, name] of files.entries()) {
  const item = index
    ? { ...fixture, similarQuestions: [], createdAt: "invalid-date" }
    : fixture;
  const bytes = exports.makeMistakeDocx(item);
  assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0x04034b50);
  writeFileSync(new URL(`../outputs/${name}`, import.meta.url), bytes);
}
const batchItems = [fixture, { ...fixture, subject: "英语", question: "第二道独立错题：选择正确时态。", incorrectAnswer: "go", correctAnswer: "went", reasoning: "根据过去时间判断。", similarQuestions: [] }];
const batchFile = "mistake-batch.docx";
writeFileSync(new URL(`../outputs/${batchFile}`, import.meta.url), exports.makeMistakesDocx(batchItems));
assert.match(exports.mistakesDocxFilename(batchItems), /2道错题练习\.docx$/);
assert.throws(() => exports.makeMistakesDocx([]), /请先选择错题/);
const imageFile = "mistake-with-chart.docx";
const chartBytes = readFileSync(new URL("./fixtures/word-chart.jpg", import.meta.url));
writeFileSync(new URL(`../outputs/${imageFile}`, import.meta.url), exports.makeMistakesDocx([{
  ...fixture, similarQuestions: [], visualQuestion: true,
  sourceImage: { bytes: chartBytes, width: 640, height: 350, fullPage: false },
}]));
const pngFile = "mistake-with-png.docx";
const pngBytes = readFileSync(new URL("./fixtures/homework-grading.png", import.meta.url));
writeFileSync(new URL(`../outputs/${pngFile}`, import.meta.url), exports.makeMistakesDocx([{
  ...fixture, similarQuestions: [], visualQuestion: true,
  sourceImage: { bytes: pngBytes, width: pngBytes.readUInt32BE(16), height: pngBytes.readUInt32BE(20), fullPage: true, mime: "image/png" },
}]));
const unitFile = "unit-practice-blueprint.docx";
writeFileSync(new URL(`../outputs/${unitFile}`, import.meta.url), exports.makeUnitPaperDocx({
  subject: "数学", unitName: "根式与分数", gradeLevel: "八年级",
  questions: [
    { question: "写出 \\(\\sqrt{9}\\) 的值", answer: "3", explanation: "算术平方根为非负数", knowledgePoint: "平方根", kind: "concept" },
    { question: "计算 \\(\\frac{1}{2}+\\frac{1}{2}\\)", answer: "1", explanation: "分母相同，分子相加", knowledgePoint: "分数", kind: "method" },
    { question: "两个半份共是多少？", answer: "1", explanation: "联系生活情境", knowledgePoint: "分数", kind: "application" },
    { question: "根据表格，计算两组数据的差。", answer: "2", explanation: "比较表中数据", knowledgePoint: "统计表", kind: "application", format: "chart", table: { headers: ["组别", "数量"], rows: [["甲", "5"], ["乙", "3"]] } },
  ],
}));
const pasteFiles = [];
for (const reflectionMode of ["saved-or-blank", "blank", "saved-plus-blank"]) {
  const name = `mistake-paste-${reflectionMode}.docx`;
  const items = batchItems.map((item, index) => ({ ...item, reflection: index ? "" : "漏看条件 <请核对>\n用自己的话说明", createdAt: index ? "2026-10-19T16:00:00Z" : "2026-10-18T16:00:00Z" }));
  const options = { ...pastePrintOptions, reflectionMode, fontSize: 14, includeAnswers: reflectionMode !== "blank", includeSimilar: false };
  writeFileSync(new URL(`../outputs/${name}`, import.meta.url), exports.makeMistakesDocx(items, options));
  assert.match(exports.mistakesDocxFilename(items, options), /2026-10-19至2026-10-20-2道错题剪贴版\.docx$/);
  pasteFiles.push(name);
}
const pasteImageFile = "mistake-paste-full-page.docx";
writeFileSync(new URL(`../outputs/${pasteImageFile}`, import.meta.url), exports.makeMistakesDocx([{
  ...fixture, similarQuestions: [], sourceImage: { bytes: pngBytes, width: pngBytes.readUInt32BE(16), height: pngBytes.readUInt32BE(20), fullPage: true, mime: "image/png" },
}], { ...pastePrintOptions, includeAnswers: false }));
pasteFiles.push(pasteImageFile);
const pasteLongFile = "mistake-paste-long-question.docx";
writeFileSync(new URL(`../outputs/${pasteLongFile}`, import.meta.url), exports.makeMistakesDocx([{
  ...fixture, question: fixture.similarQuestions[1].question, similarQuestions: [],
}], { ...pastePrintOptions, includeAnswers: false, includeSimilar: true }));
pasteFiles.push(pasteLongFile);
const pasteSimilarFile = "mistake-paste-similar.docx";
writeFileSync(new URL(`../outputs/${pasteSimilarFile}`, import.meta.url), exports.makeMistakesDocx([fixture], {
  ...pastePrintOptions, includeSimilar: true, includeAnswers: true,
}));
pasteFiles.push(pasteSimilarFile);
assert(
  !/[\\/:*?"<>|\u0000-\u001f]/.test(
    exports.mistakeDocxFilename({ ...fixture, subject: '数/学:*?"<>|' }),
  ),
);
const python = String.raw`
import sys, zipfile, xml.etree.ElementTree as ET, posixpath
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'm': 'http://schemas.openxmlformats.org/officeDocument/2006/math', 'wp': 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'}
for i, path in enumerate(sys.argv[1:]):
    with zipfile.ZipFile(path) as z:
        assert z.testzip() is None, 'ZIP integrity/CRC failed'
        for name in z.namelist():
            if name.endswith(('.xml', '.rels')): ET.fromstring(z.read(name))
        doc = ET.fromstring(z.read('word/document.xml'))
        text = '\n'.join(n.text or '' for n in doc.findall('.//w:t', ns))
        if i >= 6:
            assert '错题本剪贴版' in text and '我的错因' in text and '裁剪线' in text
            assert doc.find('.//w:pgSz', ns).get('{'+ns['w']+'}w') == '11906'
            margins = doc.find('.//w:pgMar', ns)
            assert all(margins.get('{'+ns['w']+'}'+side) == '1134' for side in ['top', 'left', 'bottom', 'right'])
            tables = doc.findall('.//w:tbl', ns)
            assert all(table.find('./w:tr/w:trPr/w:tblHeader', ns) is not None for table in tables)
            if i != 11: assert '举一反三' not in text and 'English answer' not in text
            if i < 9:
                assert len(tables) == 2 and '2026-10-19' in text and '2026-10-20' in text
                assert text.index('第 1 题') < text.index('第 2 题')
                assert len(doc.findall('.//w:br[@w:type="page"]', ns)) == (0 if i == 7 else 1)
                assert ('正确答案：1' in text) == (i != 7)
                assert ('漏看条件 <请核对>' in text) == (i != 7)
                fixed_lines = doc.findall('.//w:spacing[@w:lineRule="exact"]', ns)
                assert len(fixed_lines) == (3 if i == 6 else 6)
                styles = ET.fromstring(z.read('word/styles.xml'))
                assert styles.find('./w:docDefaults/w:rPrDefault/w:rPr/w:sz', ns).get('{'+ns['w']+'}val') == '28'
                assert all(table.findall('./w:tr', ns)[1].find('./w:trPr/w:cantSplit', ns) is not None for table in tables)
            elif i == 9:
                assert '原题整页图片' in text and '笔迹和批注' in text
                assert z.read('word/media/question-1.png')[:8] == b'\x89PNG\r\n\x1a\n'
                ext = doc.find('.//wp:extent', ns)
                assert int(ext.get('cx')) <= 6000000 and int(ext.get('cy')) <= 7800000
                assert tables[0].findall('./w:tr', ns)[1].find('./w:trPr/w:cantSplit', ns) is None
            elif i == 10:
                assert text.count('This is a long English question.') == 50
                assert len(tables) == 1 and tables[0].findall('./w:tr', ns)[1].find('./w:trPr/w:cantSplit', ns) is None
                assert len(doc.findall('.//w:br[@w:type="page"]', ns)) == 0
            else:
                assert '举一反三 1' in text and '举一反三 2' in text
                assert 'English answer' in text and 'Explanation.' in text
                assert len(doc.findall('.//w:br[@w:type="page"]', ns)) == 1
            continue
        if i == 4:
            assert '根式与分数单元练习卷' in text
            assert '基础概念' in text and '典型方法' in text and '迁移应用' in text
            assert len(doc.findall('.//m:rad', ns)) >= 1 and len(doc.findall('.//m:f', ns)) >= 1
            assert len(doc.findall('.//w:br[@w:type="page"]', ns)) == 1
            assert len(doc.findall('.//w:tbl', ns)) == 1
            assert '组别' in text and '甲' in text and '乙' in text
            continue
        assert '(-3)² + 2 × (-4)' in text
        assert '3 < 5 & 8 > 2' in text
        assert '周练 & <练习>.png' in text
        assert len(doc.findall('.//m:rad', ns)) >= 1
        assert len(doc.findall('.//m:f', ns)) >= 1
        assert '我的原答案：-17' in text and '正确答案：1' in text
        assert '\x00' not in text
        assert len(doc.findall('.//w:br[@w:type="page"]', ns)) == 1
        assert len(doc.findall('.//w:pBdr', ns)) == (2 if i in (1, 3, 5) else 8 if i == 2 else 6)
        assert ('二、举一反三' in text) == (i == 0)
        if i == 2:
            assert '第二道独立错题：选择正确时态。' in text
            assert '正确答案：went' in text
            assert '第 2 道错题' in text
            assert '错题练习单 · 2 道' in text
        if i == 3:
            assert len(doc.findall('.//w:drawing', ns)) == 1
            assert z.read('word/media/question-1.jpg')[:2] == b'\xff\xd8'
            assert doc.find('.//wp:extent', ns) is not None
        if i == 5:
            assert len(doc.findall('.//w:drawing', ns)) == 1
            assert z.read('word/media/question-1.png')[:8] == b'\x89PNG\r\n\x1a\n'
        assert doc.find('.//w:pgSz', ns).get('{'+ns['w']+'}w') == '11906'
        footer = ET.fromstring(z.read('word/footer1.xml'))
        assert footer.find('.//w:fldSimple', ns).get('{'+ns['w']+'}instr') == 'PAGE'
        rels = ET.fromstring(z.read('word/_rels/document.xml.rels'))
        for rel in rels: assert posixpath.normpath('word/'+rel.get('Target')) in z.namelist()
        if i in (3, 5): assert any(rel.get('Type', '').endswith('/image') for rel in rels)
print('PASS: ZIP/CRC, OOXML parts and relationships, Chinese/math/XML escaping, long text, page break, A4, writing space, answer key and page fields.')
`;
const result = spawnSync(
  process.platform === "win32" ? "python" : "python3",
  [
    "-c",
    python,
    ...[...files, batchFile, imageFile, unitFile, pngFile, ...pasteFiles].map((name) =>
      fileURLToPath(new URL(`../outputs/${name}`, import.meta.url)),
    ),
  ],
  { encoding: "utf8", windowsHide: true },
);
if (result.status !== 0)
  throw new Error(
    result.stderr || result.error?.message || "Word package validation failed",
  );
console.log(result.stdout.trim());

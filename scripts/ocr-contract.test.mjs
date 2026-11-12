import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Pure validation against an existing image fixture; no simulated provider/business results.
const exports = {};
const source = readFileSync(new URL("../lib/baidu-ocr.ts", import.meta.url), "utf8");
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
  exports, Uint8Array, DataView, TextEncoder, URLSearchParams, atob, fetch,
  require(name) { if (name === "cloudflare:workers") return { env: {} }; throw new Error(name); },
});
const bytes = new Uint8Array(readFileSync(new URL("./fixtures/homework-grading.png", import.meta.url)));
const image = { mime: "image/png", bytes, base64: Buffer.from(bytes).toString("base64") };

test("real photo dimensions and form encoding preserve the entire image", () => {
  const { body, size } = exports.ocrBody(image);
  assert.ok(size.width >= 15 && size.height >= 15);
  assert.equal(body.get("image"), image.base64);
  assert.equal(body.get("only_split"), "false");
  assert.equal(body.get("splice_text"), "true");
  assert.equal(body.get("detect_direction"), "false");
});
test("unsupported images are rejected before any upstream request", () => {
  assert.throws(() => exports.ocrBody({ ...image, mime: "image/webp" }), /JPG、PNG/);
});
test("encoded request limit accounts for URL escaping overhead", () => {
  assert.throws(() => exports.ocrBody({ ...image, base64: "+".repeat(4 * 1024 * 1024) }), /10MB/);
});
test("missing credentials are reported without a model fallback", async () => {
  await assert.rejects(exports.recognizePages([image]), /尚未配置/);
});

test("captured Baidu response preserves string element types and point coordinates", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/baidu-paper-cut-real.json", import.meta.url), "utf8"));
  const page = { width: fixture.width, height: fixture.height, result: {} };
  assert.match(exports.questionText(fixture.question), /38顆果凍/);
  assert.match(exports.questionText(fixture.question, [2]), /38-36/);
  assert.deepEqual(Array.from(exports.questionBounds(page, fixture.question)), [211, 160, 917, 699]);
});

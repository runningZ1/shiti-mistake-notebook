import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
loadEnvFile(path.join(projectRoot, ".deploy.vars"));

const BASE_URL = "http://127.0.0.1:3107";
const SCREENSHOT_DIR = path.join(projectRoot, "screenshots");

// 清空旧截图
if (fs.existsSync(SCREENSHOT_DIR)) {
  fs.rmSync(SCREENSHOT_DIR, { recursive: true, force: true });
}
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const defaultUser = {
  username: (process.env.SHITI_DEFAULT_USER || "").trim().toLowerCase(),
  password: process.env.SHITI_DEFAULT_PASSWORD || "",
};
const adminUser = {
  username: (process.env.SHITI_BOOTSTRAP_USER || "").trim().toLowerCase(),
  password: process.env.SHITI_BOOTSTRAP_PASSWORD || "",
};

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const tmpUserData = path.join(os.tmpdir(), "chrome-ss-final-" + Date.now());

console.log("Launching headless Chrome...");
const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--remote-debugging-port=9228",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${tmpUserData}`,
  ],
  { stdio: "ignore" }
);

function cleanup() {
  try { chrome.kill(); } catch {}
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch {}
}
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(); });

let wsUrl = null;
for (let i = 0; i < 25; i++) {
  await sleep(400);
  try {
    const res = await fetch("http://127.0.0.1:9228/json/version");
    if (res.ok) {
      const data = await res.json();
      wsUrl = data.webSocketDebuggerUrl;
      break;
    }
  } catch {}
}

if (!wsUrl) {
  console.error("Chrome debugging port not ready.");
  process.exit(1);
}

const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));

let counter = 1;
function sendRaw(method, params = {}) {
  const id = counter++;
  return new Promise((resolve, reject) => {
    const handler = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === id) {
        ws.removeEventListener("message", handler);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const { targetId } = await sendRaw("Target.createTarget", { url: "about:blank" });
const { sessionId } = await sendRaw("Target.attachToTarget", { targetId, flatten: true });

function send(method, params = {}) {
  const id = counter++;
  return new Promise((resolve, reject) => {
    const handler = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === id) {
        ws.removeEventListener("message", handler);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ id, sessionId, method, params }));
  });
}

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");

async function setViewport(width, height, isMobile = false) {
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1.5,
    mobile: isMobile,
    screenOrientation: isMobile
      ? { type: "portraitPrimary", angle: 0 }
      : { type: "landscapePrimary", angle: 90 },
  });
}

async function gotoPage(urlPath, waitTime = 1500) {
  const fullUrl = urlPath.startsWith("http") ? urlPath : `${BASE_URL}${urlPath}`;
  await send("Page.navigate", { url: fullUrl });
  await sleep(waitTime);
}

async function evaluateCode(code) {
  const res = await send("Runtime.evaluate", {
    expression: code,
    awaitPromise: true,
    returnByValue: true,
  });
  return res.result?.value;
}

async function capture(filename, { fullPage = false, waitBefore = 800 } = {}) {
  if (waitBefore > 0) await sleep(waitBefore);
  const result = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: fullPage,
  });
  const targetFile = path.join(SCREENSHOT_DIR, filename);
  fs.writeFileSync(targetFile, Buffer.from(result.data, "base64"));
  console.log(`[Captured] -> ${filename}`);
}

async function loginInPage(username, password) {
  await gotoPage("/login", 1200);
  await evaluateCode(`
    (async () => {
      const inputs = document.querySelectorAll('input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inputs[0], ${JSON.stringify(username)});
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(inputs[1], ${JSON.stringify(password)});
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
      const form = document.querySelector('form');
      form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { bubbles: true }));
    })()
  `);
  await sleep(2500);
}

async function clearCookies() {
  await send("Network.clearBrowserCookies");
}

console.log("=== 1. Public Visitor Screens ===");
await clearCookies();
await setViewport(1440, 960, false);

// 01 落地页标准桌面视口
await gotoPage("/", 1500);
await capture("01_landing_page_desktop.png", { fullPage: false });

// 02 落地页全景长图
await capture("02_landing_page_full.png", { fullPage: true });

// 03 落地页移动端
await setViewport(390, 844, true);
await gotoPage("/", 1200);
await capture("03_landing_page_mobile.png", { fullPage: false });

// 恢复桌面端
await setViewport(1440, 960, false);

// 04 登录页
await gotoPage("/login", 1200);
await capture("04_login_page.png", { fullPage: false });

// 05 注册页
await gotoPage("/register", 1200);
await capture("05_register_page.png", { fullPage: false });

// 06 会员定价页
await gotoPage("/pricing", 1500);
await capture("06_pricing_plans.png", { fullPage: true });

// 07 收银台
await gotoPage("/payment", 1200);
await capture("07_payment_checkout.png", { fullPage: false });

console.log("=== 2. Student Dashboard Screens ===");
await loginInPage(defaultUser.username, defaultUser.password);
await gotoPage("/", 2000);

// 08 学习工作台（拍照上传首页）
await capture("08_student_workbench_upload.png", { fullPage: false });

// 09 我的错题本
await evaluateCode(`
  const btn = Array.from(document.querySelectorAll('.side-nav button')).find(b => b.textContent.includes('我的错题本'));
  if (btn) btn.click();
`);
await sleep(1500);
await capture("09_student_notebook.png", { fullPage: false });

// 10 英语作文分析
await evaluateCode(`
  const btn = Array.from(document.querySelectorAll('.side-nav button')).find(b => b.textContent.includes('英语作文分析'));
  if (btn) btn.click();
`);
await sleep(1500);
await capture("10_student_essay_analysis.png", { fullPage: false });

// 11 知识图谱
await evaluateCode(`
  const btn = Array.from(document.querySelectorAll('.side-nav button')).find(b => b.textContent.includes('知识图谱'));
  if (btn) btn.click();
`);
await sleep(1500);
await capture("11_student_knowledge_map.png", { fullPage: false });

// 12 单元练习卷
await evaluateCode(`
  const btn = Array.from(document.querySelectorAll('.side-nav button')).find(b => b.textContent.includes('单元练习卷'));
  if (btn) btn.click();
`);
await sleep(1500);
await capture("12_student_unit_practice.png", { fullPage: false });

// 13 学生端移动端视口
await setViewport(390, 844, true);
await gotoPage("/", 1500);
await capture("13_student_mobile_view.png", { fullPage: false });

console.log("=== 3. Admin Console Screens ===");
await clearCookies();
await setViewport(1440, 960, false);
await loginInPage(adminUser.username, adminUser.password);

// 14 数据概览
await gotoPage("/admin?tab=overview", 2000);
await capture("14_admin_overview.png", { fullPage: false });

// 15 用户管理
await gotoPage("/admin?tab=users", 2000);
await capture("15_admin_users.png", { fullPage: false });

// 16 错题中心
await gotoPage("/admin?tab=mistakes", 2000);
await capture("16_admin_mistakes.png", { fullPage: false });

// 17 上传批次
await gotoPage("/admin?tab=uploads", 2000);
await capture("17_admin_uploads.png", { fullPage: false });

// 18 系统诊断
await gotoPage("/admin?tab=system", 2000);
await capture("18_admin_system.png", { fullPage: false });

console.log("=== ALL DONE! Clean screenshots generated. ===");

ws.close();
cleanup();
process.exit(0);

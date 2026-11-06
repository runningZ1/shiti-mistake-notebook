// Real built Workers server + isolated PostgreSQL copy; never calls the gateway.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID, randomBytes, createHmac, pbkdf2Sync } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import net from "node:net";
import pg from "pg";

const root = new URL("../", import.meta.url);
const runId = randomUUID().replaceAll("-", "");
const schema = `payment_http_${runId}`;
const dir = new URL(`work/payment-http-${runId}/`, root);
await mkdir(dir, { recursive: true });
const database = new pg.Client({ connectionString: process.env.DATABASE_URL });
await database.connect();
let child;
let pool;
let checks = 0;
let serverLog = "";
const secret = randomBytes(32).toString("hex");
const paymentSecret = randomBytes(32).toString("hex");
const source = "study.chumenclub.com";
const orderId = `ST_${randomUUID().replaceAll("-", "")}`;
const browserPassword = randomBytes(24).toString("base64url");
try {
  const { rows } = await database.query("SELECT * FROM public.users ORDER BY created_at LIMIT 1");
  assert.ok(rows[0], "real account copy required");
  const user = rows[0];
  await database.query(`CREATE SCHEMA "${schema}"`);
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set("options", `-c search_path=${schema}`);
  pool = new pg.Pool({ connectionString: url.href });
  for (const migration of ["0001_initial.sql", "0002_payment.sql", "0003_payment_test.sql"]) await pool.query(await readFile(new URL(`db/migrations/${migration}`, root), "utf8"));
  const salt = randomBytes(16);
  const hash = `pbkdf2$600000$${salt.toString("base64url")}$${pbkdf2Sync(browserPassword, salt, 600000, 32, "sha256").toString("base64url")}`;
  await pool.query(`INSERT INTO users(id,username,password_hash,display_name,role,status,trial_ends_at)
    VALUES($1,$2,$3,$4,'user','active',now()+interval '7 days')`, [user.id, user.username, hash, user.display_name]);
  const config = JSON.parse(await readFile(new URL("dist/server/wrangler.json", root), "utf8"));
  config.name = `payment-http-${runId.slice(0, 8)}`;
  config.main = fileURLToPath(new URL("dist/server/index.js", root));
  config.assets.directory = fileURLToPath(new URL("dist/client/", root));
  config.observability = { enabled: false };
  await writeFile(new URL("wrangler.json", dir), JSON.stringify(config));
  await writeFile(new URL(".dev.vars", dir), Object.entries({
    DATABASE_URL: url.href, SESSION_SECRET: secret, TRUST_OAI_HEADERS: "0", PAYMENT_ENABLED: "false",
    PAYMENT_GATEWAY_URL: "https://skills.chumenclub.com/api/cross-site-payment/create", PAYMENT_SOURCE: source,
    PAYMENT_RETURN_URL: "https://study.chumenclub.com/payment/result", PAYMENT_SHARED_SECRET: paymentSecret,
  }).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n"));
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  child = spawn(process.execPath, [fileURLToPath(new URL("node_modules/wrangler/bin/wrangler.js", root)), "dev", "--config", fileURLToPath(new URL("wrangler.json", dir)),
    "--env-file", fileURLToPath(new URL(".dev.vars", dir)), "--local", "--persist-to", fileURLToPath(new URL("state/", dir)), "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", "0"],
  { cwd: fileURLToPath(dir), env: { ...process.env, CLOUDFLARE_CF_FETCH_ENABLED: "false", WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false" }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  for (const stream of [child.stdout, child.stderr]) stream.on("data", bytes => { serverLog = (serverLog + bytes).slice(-10000); });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error("test server exited before readiness");
    try { ready = (await fetch(`${base}/pricing`)).status === 200; } catch { /* startup */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("test server failed to start; inspect private work directory logs");
  const payload = Buffer.from(JSON.stringify({ v: 1, uid: user.id, name: user.display_name, exp: Math.floor(Date.now() / 1000) + 3600, ep: 0 })).toString("base64url");
  const cookie = `shiti_session=${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
  async function check(name, fn) { await fn(); checks++; console.log(`PASS ${name}`); }
  const auth = { cookie };
  await check("anonymous orders and payment require login", async () => {
    assert.equal((await fetch(`${base}/api/orders`)).status, 401);
    assert.equal((await fetch(`${base}/api/orders`, { method: "POST" })).status, 401);
    assert.equal((await fetch(`${base}/payment`, { redirect: "manual" })).status, 307);
  });
  await check("authenticated checkout renders closed state; pricing removes placeholder flow", async () => {
    const response = await fetch(`${base}/payment`, { headers: auth });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /支付宝支付暂未开放/);
    const pricing = await (await fetch(`${base}/pricing`, { headers: auth })).text();
    assert.ok(!pricing.includes("已完成支付，提交开通登记"));
  });
  await check("gateway closed prevents any local real order creation and rejects CSRF", async () => {
    assert.equal((await fetch(`${base}/api/orders`, { method: "POST", headers: auth })).status, 503);
    assert.equal((await fetch(`${base}/api/orders`, { method: "POST", headers: { ...auth, Origin: "https://evil.test" } })).status, 403);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM payment_orders")).rows[0].n, 0);
    assert.equal((await fetch(`${base}/api/pricing/apply`, { method: "POST" })).status, 410);
  });
  await pool.query(`INSERT INTO payment_orders(id,user_id,product_id,product_name,amount_cents,duration_days,source,local_order_id,gateway_requested_at)
    VALUES($1,$2,'vip-30-days','Membership protocol test',9900,30,$3,'http-100',now())`, [orderId, user.id, source]);
  const callback = (amount = "99.00") => {
    const body = { externalOrderId: orderId, localOrderId: "http-100", status: "success", amount, timestamp: Date.now() };
    return { ...body, signature: createHmac("sha256", paymentSecret).update(body.externalOrderId + body.localOrderId + body.status + body.amount + body.timestamp).digest("base64") };
  };
  const notify = body => fetch(`${base}/api/payment-callback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  await check("HTTP callback rejects malformed, invalid signature, incorrect amount and oversize body", async () => {
    assert.equal((await notify({})).status, 400);
    assert.equal((await notify({ ...callback(), signature: "A".repeat(43) + "=" })).status, 401);
    assert.equal((await notify(callback("0.10"))).status, 409);
    assert.equal((await notify({ padding: "x".repeat(9000) })).status, 413);
  });
  await check("HTTP valid notification returns 200 and grants membership only once", async () => {
    const response = await notify(callback());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
    assert.equal((await notify(callback())).status, 200);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM payment_deliveries")).rows[0].n, 1);
    const order = await (await fetch(`${base}/api/orders/${orderId}`, { headers: auth })).json();
    assert.equal(order.order.status, "PAID");
    assert.equal(order.order.deliveryStatus, "DELIVERED");
    assert.equal((await fetch(`${base}/api/orders/${orderId}`, { headers: auth })).headers.get("cache-control"), "no-store");
  });
  await check("unknown/foreign order hidden and result page never trusts success query", async () => {
    assert.equal((await fetch(`${base}/api/orders/ST_${"0".repeat(32)}`, { headers: auth })).status, 404);
    await pool.query("UPDATE payment_orders SET user_id=NULL WHERE id=$1", [orderId]);
    assert.equal((await fetch(`${base}/api/orders/${orderId}`, { headers: auth })).status, 404);
    assert.equal((await fetch(`${base}/payment/result?success=true`, { headers: auth })).status, 200);
    await pool.query("UPDATE payment_orders SET user_id=$2 WHERE id=$1", [orderId, user.id]);
  });
  console.log(`${checks} built Workers HTTP checks passed. No upstream order created.`);
  if (process.argv.includes("--keep-server")) {
    console.log(`BROWSER_URL=${base}/payment`);
    console.log(`ISOLATED_COPY_USERNAME=${user.username}`);
    console.log(`ISOLATED_COPY_PASSWORD=${browserPassword}`);
    console.log("Only isolated copied data; press q to stop and clean up.");
    process.stdin.setEncoding("utf8");
    await once(process.stdin, "data");
    process.stdin.pause();
  }
} catch (error) {
  // Avoid dumping logs which may contain config values. Save locally for diagnosis.
  await writeFile(new URL("server.log", dir), serverLog);
  throw error;
} finally {
  if (child && child.exitCode === null) {
    child.stdin.end(); child.kill();
    await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 3000))]);
  }
  await pool?.end();
  if (!/^payment_http_[a-f0-9]{32}$/.test(schema)) throw new Error("Unsafe cleanup target");
  await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await database.end();
  // Retain bounded artifacts, but remove test credentials after the server stops.
  await writeFile(new URL(".dev.vars", dir), "# isolated test credentials cleared\n");
}

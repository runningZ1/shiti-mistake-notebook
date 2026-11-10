// Protocol/transaction tests only; no requests to the real payment gateway.
// Uses a private schema and copies one real account without logging personal data.
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import ts from "typescript";
import pg from "pg";

const root = new URL("../", import.meta.url);
const directory = new URL("work/payment-tests/", root);
await mkdir(directory, { recursive: true });
for (const name of ["payment-protocol", "payment-store", "trial"]) {
  const input = await readFile(new URL(`lib/${name}.ts`, root), "utf8");
  const output = ts.transpileModule(input, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
    .replace('"./payment-protocol"', '"./payment-protocol.mjs"');
  await writeFile(new URL(`${name}.mjs`, directory), output);
}
const protocol = await import(new URL("payment-protocol.mjs", directory));
const store = await import(new URL("payment-store.mjs", directory));
const trial = await import(new URL("trial.mjs", directory));
const source = "study.chumenclub.com";
const secret = randomUUID();
const id = () => `ST_${randomUUID().replaceAll("-", "")}`;
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
function callback(orderId, localId, amount = "99.00") {
  const body = { externalOrderId: orderId, localOrderId: localId, status: "success", amount, timestamp: Date.now() };
  return { ...body, signature: createHmac("sha256", secret).update(orderId + localId + body.status + amount + body.timestamp).digest("base64") };
}

await check("HMAC matches independent node:crypto / standard Base64", async () => {
  const text = `${id()}99.00${source}${Date.now()}`;
  assert.equal(await protocol.signPayment(text, secret), createHmac("sha256", secret).update(text).digest("base64"));
});
await check("original amount is signed; malformed/stale/tampered callbacks rejected", async () => {
  const body = callback(id(), "100", "99.0");
  await protocol.verifyCallback(body, secret);
  await assert.rejects(protocol.verifyCallback({ ...body, amount: "99.00" }, secret));
  await assert.rejects(protocol.verifyCallback({ ...body, timestamp: body.timestamp - 300001 }, secret));
  await assert.rejects(protocol.verifyCallback({ ...body, signature: body.signature.replace(/.$/, "_") }, secret));
  for (const amount of ["0.00", "-1.00", "99e0", "99.001", "NaN", "99999999.99"]) assert.throws(() => protocol.amountToCents(amount));
  assert.equal(protocol.amountToCents("0.1"), 10);
});
await check("only exact official HTTPS Alipay gateway allowed", async () => {
  assert.match(protocol.alipayDestination("https://openapi.alipay.com/gateway.do?a=b"), /^https:/);
  for (const value of ["http://openapi.alipay.com/gateway.do", "https://openapi.alipay.com.evil.test/gateway.do", "https://user@openapi.alipay.com/gateway.do", "https://openapi.alipay.com:444/gateway.do", "javascript:alert(1)"]) assert.throws(() => protocol.alipayDestination(value));
});
await check("paid expiry grants access without converting finite account to unlimited", async () => {
  assert.equal(trial.isAccessExpired("2020-01-01", "2099-01-01"), false);
  assert.equal(trial.isAccessExpired("2020-01-01", "2021-01-01"), true);
  assert.equal(trial.accessEndsAt(null, "2021-01-01"), null);
});

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required for real PostgreSQL verification");
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
await admin.connect();
const schema = `payment_test_${randomUUID().replaceAll("-", "")}`;
let pool;
try {
  const original = await admin.query("SELECT * FROM public.users ORDER BY created_at LIMIT 1");
  if (!original.rowCount) throw new Error("A real account is required as the isolated test copy");
  const real = original.rows[0];
  await admin.query(`CREATE SCHEMA "${schema}"`);
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}`, max: 6 });
  for (const migration of ["0001_initial.sql", "0002_payment.sql", "0003_payment_test.sql"]) await pool.query(await readFile(new URL(`db/migrations/${migration}`, root), "utf8"));
  await pool.query(`INSERT INTO users(id,username,password_hash,display_name,role,status,trial_ends_at)
    VALUES($1,$2,$3,$4,'user','active',now()+interval '7 days')`, [real.id, real.username, real.password_hash, real.display_name]);
  async function tx(fn) {
    const client = await pool.connect();
    try { await client.query("BEGIN"); const value = await fn(client); await client.query("COMMIT"); return value; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async function order() {
    const value = id();
    await pool.query(`INSERT INTO payment_orders(id,user_id,product_id,product_name,amount_cents,duration_days,source,gateway_requested_at)
      VALUES($1,$2,'vip-30-days','Membership protocol test',9900,30,$3,now())`, [value, real.id, source]);
    return value;
  }
  await check("real PostgreSQL migrations preserve original data and add payment tables", async () => {
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM users")).rows[0].n, 1);
    assert.equal((await pool.query("SELECT paid_ends_at FROM users")).rows[0].paid_ends_at, null);
  });
  const early = await order();
  await check("early callback persisted, no delivery before trusted mapping; reject amount/source mismatch", async () => {
    await assert.rejects(tx(c => store.recordCallback(c, callback(early, "100", "0.10"), source)));
    await assert.rejects(tx(c => store.recordCallback(c, callback(early, "100"), "other.test")));
    await tx(c => store.recordCallback(c, callback(early, "100"), source));
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM payment_events")).rows[0].n, 1);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM payment_deliveries")).rows[0].n, 0);
    await assert.rejects(tx(c => store.bindGateway(c, early, "wrong-map", source)));
    await tx(c => store.bindGateway(c, early, "100", source));
    assert.equal((await pool.query("SELECT status,delivery_status FROM payment_orders WHERE id=$1", [early])).rows[0].delivery_status, "DELIVERED");
  });
  const expiry = (await pool.query("SELECT paid_ends_at,trial_ends_at FROM users")).rows[0];
  await check("membership preserves trial then adds exactly 30 days", async () => {
    assert.equal(new Date(expiry.paid_ends_at) - new Date(expiry.trial_ends_at), 30 * 86400000);
  });
  await check("concurrent duplicate callbacks never duplicate delivery or extend expiry", async () => {
    await Promise.all(Array.from({ length: 8 }, () => tx(c => store.recordCallback(c, callback(early, "100"), source))));
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM payment_deliveries")).rows[0].n, 1);
    assert.equal(+(await pool.query("SELECT paid_ends_at FROM users")).rows[0].paid_ends_at, +expiry.paid_ends_at);
    await assert.rejects(tx(c => store.recordCallback(c, callback(early, "101"), source)));
  });
  const renewal = await order();
  await check("normal notification and renewal add once; pending uniqueness enforced", async () => {
    await assert.rejects(order());
    await tx(c => store.bindGateway(c, renewal, "200", source));
    await tx(c => store.recordCallback(c, callback(renewal, "200"), source));
    assert.equal(+(await pool.query("SELECT paid_ends_at FROM users")).rows[0].paid_ends_at - +expiry.paid_ends_at, 30 * 86400000);
  });
  const disabled = await order();
  await check("disabled account payment recorded for review without granting access", async () => {
    await tx(c => store.bindGateway(c, disabled, "300", source));
    await pool.query("UPDATE users SET status='disabled'");
    await tx(c => store.recordCallback(c, callback(disabled, "300"), source));
    assert.equal((await pool.query("SELECT delivery_status FROM payment_orders WHERE id=$1", [disabled])).rows[0].delivery_status, "REVIEW");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM payment_deliveries")).rows[0].n, 2);
  });
  await check("transaction rollback leaves no partial event/payment/entitlement", async () => {
    await pool.query("UPDATE users SET status='active'");
    const rolled = await order();
    await tx(c => store.bindGateway(c, rolled, "400", source));
    await assert.rejects(tx(async c => { await store.recordCallback(c, callback(rolled, "400"), source); throw new Error("rollback test"); }));
    assert.equal((await pool.query("SELECT status FROM payment_orders WHERE id=$1", [rolled])).rows[0].status, "PENDING");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM payment_events WHERE order_id=$1", [rolled])).rows[0].n, 0);
  });
  await check("account deletion retains financial records and late payment goes to review", async () => {
    const pending = (await pool.query("SELECT id FROM payment_orders WHERE status='PENDING'")).rows[0].id;
    await pool.query("DELETE FROM users WHERE id=$1", [real.id]);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM payment_orders WHERE user_id IS NULL")).rows[0].n, 4);
    await tx(c => store.recordCallback(c, callback(pending, "400"), source));
    assert.equal((await pool.query("SELECT delivery_status FROM payment_orders WHERE id=$1", [pending])).rows[0].delivery_status, "REVIEW");
  });
} finally {
  await pool?.end();
  // Exact generated schema; never delete public or the source data.
  if (!/^payment_test_[a-f0-9]{32}$/.test(schema)) throw new Error("Unsafe cleanup target");
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
}
console.log(`${passed} payment protocol / real PostgreSQL checks passed. No real payment created.`);

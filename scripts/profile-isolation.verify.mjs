import assert from "node:assert/strict";
import { readFile, readdir, mkdir, writeFile, access, rename } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import pg from "pg";

// Real PostgreSQL and real local records only. No production execution: refuses
// remote connections. Default: rollback. --keep-schema retains an acceptance
// copy only after every check passes; it never alters public.
const url = new URL(process.env.DATABASE_URL || "postgres://invalid");
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("仅允许本机真实数据库副本验证");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const keepArg = process.argv.find(arg => arg.startsWith("--keep-schema="));
const writeEnv = process.argv.includes("--write-env");
if (writeEnv && !keepArg) throw new Error("写验收配置必须同时保留独立schema");
const schema = keepArg ? keepArg.slice("--keep-schema=".length) : "profile_verify_" + randomUUID().replaceAll("-", "");
if (!/^profile_(verify|acceptance)_[a-z0-9_]+$/.test(schema) || schema.length > 63) throw new Error("独立schema名称必须使用profile_verify_或profile_acceptance_前缀");
const artifactDir = resolve("work/profile-isolation");
await mkdir(artifactDir, { recursive: true });
const backup = resolve(artifactDir, `public-${Date.now()}.dump`);
const pgEnvironment = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || "5432", PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url["pass" + "word"]) };
delete pgEnvironment.PGOPTIONS;
let pgDump = process.env.PROFILE_PG_DUMP || "pg_dump";
if (process.platform === "win32" && !process.env.PROFILE_PG_DUMP) {
  for (const version of ["18", "17", "16"]) {
    const candidate = `C:/Program Files/PostgreSQL/${version}/bin/pg_dump.exe`;
    try { await access(candidate); pgDump = candidate; break; } catch { /* Try the next installed version. */ }
  }
}
const dump = spawnSync(pgDump, ["--format=custom", "--schema=public", "--no-owner", "--file", backup], { env: pgEnvironment, windowsHide: true, encoding: "utf8" });
if (dump.status !== 0) throw new Error("pg_dump备份失败，停止隔离迁移；请检查本地PostgreSQL工具版本和连接配置");
const pgRestore = pgDump.includes("/") || pgDump.includes("\\") ? resolve(dirname(pgDump), process.platform === "win32" ? "pg_restore.exe" : "pg_restore") : "pg_restore";
const archive = spawnSync(pgRestore, ["--list", backup], { env: pgEnvironment, windowsHide: true, encoding: "utf8" });
if (archive.status !== 0 || !archive.stdout.includes("TABLE DATA")) throw new Error("备份归档目录验证失败");
const tables = ["users", "uploads", "upload_objects", "mistakes", "practice_papers", "knowledge_units", "essay_reports"];
const copyTables = [...tables, "payment_orders", "payment_events", "payment_deliveries"];
const q = name => '"' + name.replaceAll('"', '""') + '"';
const migrationDir = new URL("../db/migrations/", import.meta.url);
const migrationFiles = (await readdir(migrationDir)).filter(name => /^\d{4}_.*\.sql$/.test(name)).sort();
const migrationContents = Object.fromEntries(await Promise.all(migrationFiles.map(async name => [name, await readFile(new URL(name, migrationDir), "utf8")])));
const migrationChecksums = Object.fromEntries(migrationFiles.map(name => [name, createHash("sha256").update(migrationContents[name]).digest("hex")]));
// Independent, explicit expectations for 0012. Unknown labels must stay exact.
// Keep subject in the whole-row hash; never exclude it from preservation checks.
const normalizesSubjects = migrationFiles.includes("0012_subject_normalization.sql");
const subjectAliases = JSON.stringify({
  小学数学: "数学", 初中数学: "数学", 高中数学: "数学",
  小学语文: "语文", 初中语文: "语文", 高中语文: "语文",
  小学英语: "英语", 初中英语: "英语", 高中英语: "英语", 政治: "道德与法治",
});
let checks = 0;
let committed = false;
async function rejects(sql, values, code) {
  await client.query("SAVEPOINT rejected_write");
  let rejected = false;
  try { await client.query(sql, values); }
  catch (error) { assert.equal(error.code, code); rejected = true; }
  finally { await client.query("ROLLBACK TO SAVEPOINT rejected_write"); }
  assert.ok(rejected, "隔离写入必须被拒绝"); checks++;
}
await client.connect();
try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  await client.query(`CREATE SCHEMA ${q(schema)}`);
  await client.query(`SET LOCAL search_path TO ${q(schema)}, pg_catalog`);
  for (const file of migrationFiles.filter(name => /^000[1-7]_.*\.sql$/.test(name))) {
    await client.query(migrationContents[file]);
  }
  const before = {};
  for (const table of copyTables) {
    const { rows } = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position", [schema, table]);
    const cols = rows.map(row => q(row.column_name)).join(",");
    await client.query(`ALTER TABLE ${q(table)} DISABLE TRIGGER USER`);
    await client.query(`INSERT INTO ${q(table)} (${cols}) SELECT ${cols} FROM public.${q(table)}`);
    await client.query(`ALTER TABLE ${q(table)} ENABLE TRIGGER USER`);
    before[table] = (await client.query(`SELECT count(*)::int AS n FROM ${q(table)}`)).rows[0].n;
  }
  assert.ok(before.users && before.uploads && before.mistakes, "需要已有真实账号、作业及错题，不生成替代资料");
  const original = (await client.query(normalizesSubjects
    ? "SELECT md5(string_agg((to_jsonb(u) || jsonb_build_object('subject',COALESCE($1::jsonb ->> u.subject,u.subject),'original_subject',u.subject))::text, '' ORDER BY id)) AS hash FROM uploads u"
    : "SELECT md5(string_agg(to_jsonb(u)::text, '' ORDER BY id)) AS hash FROM uploads u", normalizesSubjects ? [subjectAliases] : [])).rows[0].hash;
  const reflection = (await client.query(normalizesSubjects
    ? "SELECT md5(string_agg((to_jsonb(m) || jsonb_build_object('subject',COALESCE($1::jsonb ->> m.subject,m.subject)))::text, '' ORDER BY id)) AS hash FROM mistakes m"
    : "SELECT md5(string_agg(to_jsonb(m)::text, '' ORDER BY id)) AS hash FROM mistakes m", normalizesSubjects ? [subjectAliases] : [])).rows[0].hash;
  await client.query(migrationContents["0008_learning_profiles.sql"]);
  const laterMigrations = migrationFiles.filter(name => name > "0008_learning_profiles.sql");
  for (const file of laterMigrations) await client.query(migrationContents[file]);
  for (const table of tables) {
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM ${q(table)}`)).rows[0].n, before[table]); checks++;
    if (table !== "users") {
      assert.equal((await client.query(`SELECT count(*)::int AS n FROM ${q(table)} WHERE profile_id <> 'default:' || user_id OR profile_id IS NULL`)).rows[0].n, 0); checks++;
    }
  }
  for (const table of copyTables.filter(table => !tables.includes(table))) {
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM ${q(table)}`)).rows[0].n, before[table]); checks++;
  }
  const uploadAddedFields = ['profile_id','title','homework_date','grade_level','intent','request_key','photo_hash','page_metadata'];
  if (!normalizesSubjects) uploadAddedFields.push('original_subject');
  assert.equal((await client.query("SELECT md5(string_agg((to_jsonb(u) - $1::text[])::text, '' ORDER BY id)) AS hash FROM uploads u", [uploadAddedFields])).rows[0].hash, original); checks++;
  assert.equal((await client.query("SELECT md5(string_agg((to_jsonb(m) - ARRAY['profile_id','removed_at','source_question_id','question_version','archive_kind','judgement_source'])::text, '' ORDER BY id)) AS hash FROM mistakes m")).rows[0].hash, reflection); checks++;
  if (normalizesSubjects) {
    assert.equal((await client.query("SELECT count(*)::int AS n FROM uploads u JOIN public.uploads old ON old.id=u.id WHERE u.original_subject IS DISTINCT FROM old.subject")).rows[0].n, 0); checks++;
  }
  const row = (await client.query("SELECT m.id,m.upload_id,m.user_id,m.profile_id FROM mistakes m JOIN users u ON u.id=m.user_id WHERE u.status='active' AND u.deletion_started_at IS NULL LIMIT 1")).rows[0];
  assert.ok(row, "需要启用账号的真实错题副本");
  const secondId = randomUUID();
  // A temporary test container, not an invented child or learning record.
  await client.query("INSERT INTO learning_profiles(id,user_id,name) VALUES($1,$2,'隔离验证容器')", [secondId, row.user_id]);
  for (const table of tables.filter(t => t !== "users")) {
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM ${q(table)} WHERE user_id=$1 AND profile_id=$2`, [row.user_id, secondId])).rows[0].n, 0); checks++;
  }
  await rejects("UPDATE uploads SET profile_id=$1 WHERE id=$2", [secondId,row.upload_id], "23514");
  await rejects("UPDATE mistakes SET profile_id=$1 WHERE id=$2", [secondId,row.id], "23514");
  // Test the composite FK independently from the immutability trigger.
  await client.query("ALTER TABLE mistakes DISABLE TRIGGER mistakes_preserve_owner");
  await rejects("UPDATE mistakes SET profile_id=$1 WHERE id=$2", [secondId,row.id], "23503");
  await rejects("UPDATE mistakes SET profile_id=$1 WHERE id=$2", ["nonexistent-profile",row.id], "23503");
  await client.query("ALTER TABLE mistakes ENABLE TRIGGER mistakes_preserve_owner");
  await client.query("ALTER TABLE uploads DISABLE TRIGGER uploads_preserve_owner");
  const otherUser = (await client.query("SELECT id FROM users WHERE id <> $1 LIMIT 1", [row.user_id])).rows[0];
  if (otherUser) {
    await rejects("UPDATE uploads SET profile_id=$1 WHERE id=$2", ["default:" + otherUser.id,row.upload_id], "23503");
  }
  await client.query("ALTER TABLE uploads ENABLE TRIGGER uploads_preserve_owner");
  const object = (await client.query("SELECT o.key FROM upload_objects o WHERE o.user_id=$1 AND starts_with(o.key,$1 || '/' || $2 || '/') LIMIT 1", [row.user_id,row.upload_id])).rows[0];
  if (object) {
    await client.query("ALTER TABLE upload_objects DISABLE TRIGGER upload_objects_preserve_owner");
    await rejects("UPDATE upload_objects SET profile_id=$1 WHERE key=$2", [secondId,object.key], "23514");
    await client.query("ALTER TABLE upload_objects ENABLE TRIGGER upload_objects_preserve_owner");
  }
  const preserved = (await client.query("SELECT to_jsonb(m) - 'removed_at' AS data FROM mistakes m WHERE id=$1", [row.id])).rows[0].data;
  await client.query("UPDATE mistakes SET removed_at=COALESCE(removed_at,now()) WHERE id=$1 AND user_id=$2 AND profile_id=$3", [row.id,row.user_id,row.profile_id]);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM mistakes WHERE id=$1 AND removed_at IS NULL",[row.id])).rows[0].n, 0); checks++;
  await client.query("UPDATE mistakes SET removed_at=NULL WHERE id=$1 AND user_id=$2 AND profile_id=$3", [row.id,row.user_id,row.profile_id]);
  assert.deepEqual((await client.query("SELECT to_jsonb(m) - 'removed_at' AS data FROM mistakes m WHERE id=$1",[row.id])).rows[0].data, preserved); checks++;
  const hasQuestionDrafts = (await client.query("SELECT to_regclass('question_edit_drafts') IS NOT NULL AS present")).rows[0].present;
  if (hasQuestionDrafts) {
    await client.query("SAVEPOINT question_draft_checks");
    // Copy existing real text into a temporary draft, never invent a question.
    await client.query("INSERT INTO question_edit_drafts(upload_id,user_id,profile_id,draft_key,payload) SELECT upload_id,user_id,profile_id,'profile-isolation-check',jsonb_build_object('question',question) FROM mistakes WHERE id=$1", [row.id]);
    await rejects("UPDATE question_edit_drafts SET profile_id=$1 WHERE upload_id=$2 AND draft_key='profile-isolation-check'", [secondId,row.upload_id], "23514");
    await rejects("INSERT INTO question_edit_drafts(upload_id,user_id,profile_id,draft_key,payload) SELECT upload_id,user_id,$1,'profile-isolation-cross-check',jsonb_build_object('question',question) FROM mistakes WHERE id=$2", [secondId,row.id], "23503");
    await client.query("UPDATE users SET status='disabled' WHERE id=$1", [row.user_id]);
    await rejects("UPDATE question_edit_drafts SET revision=revision+1 WHERE upload_id=$1 AND draft_key='profile-isolation-check'", [row.upload_id], "23514");
    await client.query("ROLLBACK TO SAVEPOINT question_draft_checks");
  }
  // Do not retain the temporary validation container in the browser acceptance schema.
  await client.query("DELETE FROM learning_profiles WHERE id=$1", [secondId]);
  for (const file of migrationFiles) {
    assert.equal(createHash("sha256").update(await readFile(new URL(file, migrationDir), "utf8")).digest("hex"), migrationChecksums[file], "迁移在验证期间发生变化，必须重跑");
  }
  const evidence = { passed: true, checks, schema, backup, envConfig: writeEnv ? ".env.requirements-verify" : null, realCopyCounts: before, migrations: migrationFiles, migrationChecksums, scope: keepArg ? "local isolated schema retained; public unchanged" : "local transaction; isolated schema rolled back", verifiedAt: new Date().toISOString() };
  if (keepArg) { await client.query("COMMIT"); committed = true; }
  if (writeEnv) {
    const acceptanceUrl = new URL(url);
    // No public fallback: missing tables must fail, never hit real public data.
    acceptanceUrl.searchParams.set("options", "-c search_path=" + schema);
    const envFile = resolve(".env.requirements-verify");
    await writeFile(envFile + ".tmp", "DATABASE_URL=" + JSON.stringify(acceptanceUrl.toString()) + "\n", { mode: 0o600 });
    await rename(envFile + ".tmp", envFile);
  }
  await writeFile(resolve(artifactDir, "verification.json"), JSON.stringify(evidence, null, 2) + "\n");
  await writeFile(resolve(artifactDir, `verification-${schema}.json`), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence));
} catch (error) {
  console.error(JSON.stringify({ passed: false, code: error.code || error.name, committed, message: committed ? "副本已提交，证据或配置写入失败；public未修改。" : "隔离迁移回归未通过；已回滚，不输出业务内容或凭据。" }));
  process.exitCode = 1;
} finally {
  if (!committed) await client.query("ROLLBACK");
  await client.end();
}

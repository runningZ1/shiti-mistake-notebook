import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { accountFromEnv, passwordMatches, seedAccount } from "./seed-user.mjs";

loadEnvFile(fileURLToPath(new URL("../.deploy.vars", import.meta.url)));
if (!process.env.DATABASE_URL) throw new Error("未配置 PostgreSQL DATABASE_URL");
const accounts = [accountFromEnv(false, true), accountFromEnv(true)];
if (accounts[0].id === accounts[1].id || accounts[0].username === accounts[1].username)
  throw new Error("默认用户与管理员的 ID、用户名必须不同");

const checkOnly = process.argv.includes("--dry-run");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  if (!checkOnly) {
    await client.query("BEGIN");
    let completed = false;
    try {
      for (const account of accounts) await seedAccount(client, account);
      // 只有完全没有管理员时才恢复引导管理员权限。
      await client.query(
        "UPDATE users SET role='admin' WHERE id=$1 AND status='active' AND deletion_started_at IS NULL AND NOT EXISTS (SELECT 1 FROM users WHERE role='admin')",
        [accounts[0].id],
      );
      await client.query("COMMIT");
      completed = true;
    } finally {
      if (!completed) await client.query("ROLLBACK");
    }
  }
  for (const account of accounts) {
    const { rows } = await client.query(
      "SELECT id, username, password_hash, role, status, deletion_started_at FROM users WHERE id=$1 OR username=$2",
      [account.id, account.username],
    );
    if (rows.length !== 1 || rows[0].id !== account.id || rows[0].username !== account.username)
      throw new Error("数据库账号缺失或 ID 与用户名冲突，请检查配置并初始化账号");
    const row = rows[0];
    if (row.role !== account.role || row.status !== "active" || row.deletion_started_at !== null)
      throw new Error("数据库账号角色或启用状态与默认账号用途不符");
    if (!passwordMatches(account.password, row.password_hash))
      throw new Error("数据库现有账号密码与 .deploy.vars 不匹配，请更新凭据配置");
  }
  console.log(checkOnly
    ? "PostgreSQL 两组真实账号、密码、角色与状态校验通过；未修改数据库。"
    : "PostgreSQL 默认账号初始化并校验通过；已有账号凭据保持原值。");
} finally {
  await client.end();
}

import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";

const ITERATIONS = 600000;

export function accountFromEnv(isDefaultUser = false, admin = false) {
  const prefix = isDefaultUser ? "SHITI_DEFAULT" : "SHITI_BOOTSTRAP";
  const username = (process.env[`${prefix}_USER`] || "").trim().toLowerCase();
  const password = process.env[`${prefix}_PASSWORD`] || "";
  const displayName = (process.env[`${prefix}_NAME`] || "").trim() || username;
  // 保留历史数据关联使用的用户 ID。
  const id = (process.env[`${prefix}_ID`] || "").trim() || (isDefaultUser ? "shiti-user" : "shiti");
  if (!/^[a-z0-9_-]{3,32}$/.test(username) || !/^[A-Za-z0-9_-]+$/.test(id) || displayName.length > 24)
    throw new Error(`${prefix} 用户名、ID 或昵称格式不正确`);
  if (password.length < 8 || password.length > 128)
    throw new Error(`${prefix}_PASSWORD 必须为 8–128 位`);
  return { id, username, password, displayName, role: !isDefaultUser && admin ? "admin" : "user" };
}

export function passwordMatches(password, encoded) {
  const [algorithm, iterations, salt, expected] = encoded.split("$");
  if (algorithm !== "pbkdf2" || !/^\d+$/.test(iterations) || !salt || !expected)
    throw new Error("账号密码哈希格式不正确");
  const stored = Buffer.from(expected, "base64url");
  const actual = pbkdf2Sync(password, Buffer.from(salt, "base64url"), Number(iterations), stored.length, "sha256");
  return timingSafeEqual(stored, actual);
}

export async function seedAccount(client, account) {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(account.password, salt, ITERATIONS, 32, "sha256");
  const hash = `pbkdf2$${ITERATIONS}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
  const result = await client.query(
    "INSERT INTO users (id, username, password_hash, display_name, role) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING id",
    [account.id, account.username, hash, account.displayName, account.role],
  );
  const { rows } = await client.query("SELECT id, username FROM users WHERE id=$1 OR username=$2", [account.id, account.username]);
  if (rows.length !== 1 || rows[0].id !== account.id || rows[0].username !== account.username)
    throw new Error("账号 ID 与用户名对应关系冲突");
  return result.rowCount === 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.DATABASE_URL) throw new Error("未配置 PostgreSQL DATABASE_URL");
  const account = accountFromEnv(process.argv.includes("--default-user"), process.argv.includes("--admin"));
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const created = await seedAccount(client, account);
    console.log(created ? "账号已创建" : "账号已存在，保留已有凭据、角色与状态");
  } finally {
    await client.end();
  }
}

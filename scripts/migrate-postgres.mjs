import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("未配置 PostgreSQL DATABASE_URL");
const directory = fileURLToPath(new URL("../db/migrations/", import.meta.url));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("SELECT pg_advisory_lock(172904, 2)");
  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
  for (const name of (await readdir(directory)).filter(name => name.endsWith(".sql")).sort()) {
    const sql = await readFile(directory + "/" + name, "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const { rows } = await client.query("SELECT checksum FROM schema_migrations WHERE name=$1", [name]);
    if (rows.length) {
      if (rows[0].checksum !== checksum) throw new Error("已执行迁移内容发生变化：" + name);
      console.log("迁移已执行：" + name);
      continue;
    }
    await client.query("BEGIN");
    let completed = false;
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)", [name, checksum]);
      await client.query("COMMIT");
      completed = true;
      console.log("迁移完成：" + name);
    } finally {
      if (!completed) await client.query("ROLLBACK");
    }
  }
} finally {
  await client.end();
}

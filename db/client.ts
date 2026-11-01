import { env } from "cloudflare:workers";
import { Pool, types, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

// 接口使用 ISO 时间，数据库保留带时区的时间类型。
types.setTypeParser(1184, (value: string) => new Date(value).toISOString());
types.setTypeParser(20, (value: string) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error("数据库整数超出安全范围");
  return number;
});

export function createPool() {
  if (!env.DATABASE_URL) throw new Error("未配置 PostgreSQL DATABASE_URL");
  return new Pool({ connectionString: env.DATABASE_URL, max: 4, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000 });
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>> {
  const pool = createPool();
  try {
    return await pool.query<T>(text, values);
  } finally {
    await pool.end();
  }
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let completed = false;
    try {
      const result = await fn(client);
      await client.query("COMMIT");
      completed = true;
      return result;
    } finally {
      if (!completed) await client.query("ROLLBACK");
    }
  } finally {
    client.release();
    await pool.end();
  }
}

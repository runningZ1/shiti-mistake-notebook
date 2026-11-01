import { env } from "cloudflare:workers";
import { query, transaction } from "@/db/client";
import { trialEndFrom } from "@/lib/trial";

export type UserRole = "user" | "admin";
export type UserStatus = "active" | "disabled";
export type UserRecord = {
  id: string;
  username: string;
  passwordHash: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  sessionEpoch: number;
  createdAt: string;
  lastLoginAt: string | null;
  trialEndsAt: string | null;
};
type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  role: string;
  status: string;
  session_epoch: number;
  created_at: string;
  last_login_at: string | null;
  trial_ends_at: string | null;
  deletion_started_at: string | null;
};

const COLUMNS = "id, username, password_hash, display_name, role, status, session_epoch, created_at, last_login_at, trial_ends_at, deletion_started_at";

function toRecord(row: UserRow): UserRecord {
  return {
    id: row.id, username: row.username, passwordHash: row.password_hash,
    displayName: row.display_name, role: row.role === "admin" ? "admin" : "user",
    status: row.status === "active" && row.deletion_started_at === null ? "active" : "disabled",
    sessionEpoch: row.session_epoch,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    trialEndsAt: row.trial_ends_at,
  };
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  const { rows } = await query<UserRow>(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] ? toRecord(rows[0]) : null;
}
export async function findUserByUsername(username: string): Promise<UserRecord | null> {
  const { rows } = await query<UserRow>(`SELECT ${COLUMNS} FROM users WHERE username = $1`, [username]);
  return rows[0] ? toRecord(rows[0]) : null;
}
export type AdminUserRow = {
  id: string; username: string; displayName: string; role: UserRole; status: UserStatus;
  createdAt: string; lastLoginAt: string | null; wechat: string | null;
  trialEndsAt: string | null; deletionStartedAt: string | null; mistakeCount: number;
};
export async function listUsersWithCounts(): Promise<AdminUserRow[]> {
  const { rows } = await query<UserRow & { wechat: string | null; mistake_count: string }>(
    "SELECT u.*, COUNT(m.id) AS mistake_count FROM users u LEFT JOIN mistakes m ON m.user_id = u.id GROUP BY u.id ORDER BY u.created_at",
  );
  return rows.map(row => ({
    id: row.id, username: row.username, displayName: row.display_name,
    role: row.role === "admin" ? "admin" : "user",
    status: row.status === "active" && row.deletion_started_at === null ? "active" : "disabled",
    createdAt: row.created_at, lastLoginAt: row.last_login_at,
    wechat: row.wechat || null, trialEndsAt: row.trial_ends_at,
    deletionStartedAt: row.deletion_started_at, mistakeCount: Number(row.mistake_count),
  }));
}
export async function countActiveAdmins(): Promise<number> {
  const { rows } = await query<{ n: string }>("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active' AND deletion_started_at IS NULL");
  return Number(rows[0].n);
}
export type NewUser = {
  id: string; username: string; passwordHash: string; displayName: string;
  role?: UserRole; wechat?: string | null; startTrial?: boolean;
};
export async function insertUser(user: NewUser): Promise<void> {
  const now = Date.now();
  await query(
    "INSERT INTO users (id, username, password_hash, display_name, role, status, session_epoch, created_at, wechat, trial_ends_at) VALUES ($1, $2, $3, $4, $5, 'active', 0, $6, $7, $8)",
    [user.id, user.username, user.passwordHash, user.displayName, user.role ?? "user", new Date(now).toISOString(), user.wechat || null, user.startTrial ? trialEndFrom(now) : null],
  );
}
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "23505";
}
export async function setWechat(id: string, wechat: string): Promise<void> {
  await query("UPDATE users SET wechat = $1 WHERE id = $2 AND deletion_started_at IS NULL", [wechat || null, id]);
}
export type UserUpdate = {
  displayName?: string; role?: UserRole; status?: UserStatus; passwordHash?: string;
  wechat?: string; trialAction?: "extend7" | "unlimited";
};
export type UserUpdateResult = "updated" | "not-found" | "unlimited" | "last-admin" | "deleting";

export async function updateUser(id: string, update: UserUpdate): Promise<UserUpdateResult> {
  return transaction(async client => {
    // 管理员集合的变更共用事务锁，避免两个事务同时移除最后的管理员。
    await client.query("SELECT pg_advisory_xact_lock(172904, 1)");
    const { rows } = await client.query<UserRow>(`SELECT ${COLUMNS} FROM users WHERE id = $1 FOR UPDATE`, [id]);
    const current = rows[0];
    if (!current) return "not-found";
    if (current.deletion_started_at !== null) return "deleting";
    if (update.trialAction === "extend7" && current.trial_ends_at === null) return "unlimited";
    if (current.role === "admin" && current.status === "active" &&
      ((update.role ?? current.role) !== "admin" || (update.status ?? current.status) !== "active")) {
      const other = await client.query("SELECT id FROM users WHERE id <> $1 AND role = 'admin' AND status = 'active' AND deletion_started_at IS NULL LIMIT 1", [id]);
      if (other.rows.length === 0) return "last-admin";
    }
    const assignments: string[] = [];
    const values: unknown[] = [];
    for (const [field, value] of [
      ["display_name", update.displayName], ["role", update.role], ["status", update.status],
      ["password_hash", update.passwordHash], ["wechat", update.wechat === undefined ? undefined : update.wechat || null],
    ] as const) {
      if (value !== undefined) {
        values.push(value);
        assignments.push(`${field} = $${values.length}`);
      }
    }
    if (update.trialAction === "unlimited") assignments.push("trial_ends_at = NULL");
    if (update.trialAction === "extend7") assignments.push("trial_ends_at = greatest(trial_ends_at, clock_timestamp()) + interval '7 days'");
    values.push(Number(update.status !== undefined) + Number(update.passwordHash !== undefined));
    assignments.push(`session_epoch = session_epoch + $${values.length}`);
    values.push(id);
    await client.query(`UPDATE users SET ${assignments.join(", ")} WHERE id = $${values.length}`, values);
    return "updated";
  });
}
export async function touchLastLogin(id: string): Promise<void> {
  await query("UPDATE users SET last_login_at = $1 WHERE id = $2 AND status = 'active' AND deletion_started_at IS NULL", [new Date().toISOString(), id]);
}
export async function beginUserDeletion(id: string): Promise<"reserved" | "not-found" | "last-admin"> {
  return transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(172904, 1)");
    const { rows } = await client.query<UserRow>(`SELECT ${COLUMNS} FROM users WHERE id = $1 FOR UPDATE`, [id]);
    const current = rows[0];
    if (!current) return "not-found";
    if (current.deletion_started_at === null && current.role === "admin" && current.status === "active") {
      const other = await client.query("SELECT id FROM users WHERE id <> $1 AND role = 'admin' AND status = 'active' AND deletion_started_at IS NULL LIMIT 1", [id]);
      if (other.rows.length === 0) return "last-admin";
    }
    await client.query("UPDATE users SET deletion_started_at = coalesce(deletion_started_at, clock_timestamp()), status = 'disabled', session_epoch = session_epoch + CASE WHEN deletion_started_at IS NULL THEN 1 ELSE 0 END WHERE id = $1", [id]);
    return "reserved";
  });
}
export async function listUploadFileKeys(userId: string): Promise<string[]> {
  const { rows } = await query<{ id: string; file_keys: string }>("SELECT id, file_keys::text FROM uploads WHERE user_id = $1", [userId]);
  const keys = new Set<string>();
  for (const row of rows) {
    const parsed: unknown = JSON.parse(row.file_keys);
    if (!Array.isArray(parsed) || parsed.some((key: unknown) => typeof key !== "string" || key.length === 0)) {
      throw new Error(`上传记录 ${row.id} 的 file_keys 必须是非空字符串组成的数组`);
    }
    for (const key of parsed) keys.add(key);
  }
  const objects = await query<{ key: string }>("SELECT key FROM upload_objects WHERE user_id = $1", [userId]);
  for (const object of objects.rows) keys.add(object.key);
  return [...keys];
}
export async function abortUserImageUploads(userId: string): Promise<void> {
  const { rows } = await query<{ key: string; multipart_id: string }>("SELECT key, multipart_id FROM upload_objects WHERE user_id = $1", [userId]);
  if (rows.length === 0) return;
  if (!env.BUCKET) throw new Error("图片存储未绑定，无法终止上传");
  for (const object of rows) await env.BUCKET.resumeMultipartUpload(object.key, object.multipart_id).abort();
}
export async function deleteUserRows(userId: string): Promise<boolean> {
  return transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(172904, 1)");
    const { rows } = await client.query("SELECT id FROM users WHERE id = $1 AND deletion_started_at IS NOT NULL AND status = 'disabled' FOR UPDATE", [userId]);
    if (rows.length === 0) return false;
    for (const table of ["mistakes", "uploads", "practice_papers", "essay_reports", "knowledge_units", "upload_objects"]) {
      await client.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
    }
    await client.query("DELETE FROM users WHERE id = $1", [userId]);
    return true;
  });
}

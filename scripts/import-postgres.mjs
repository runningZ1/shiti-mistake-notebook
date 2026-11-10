import { DatabaseSync } from "node:sqlite";
import pg from "pg";

const sourcePath = process.argv[2];
if (!sourcePath || !process.env.DATABASE_URL) throw new Error("需要 DATABASE_URL 和原始 SQLite 数据库路径");
const source = new DatabaseSync(sourcePath, { readOnly: true });
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const tables = [
  ["users", ["id","username","password_hash","display_name","created_at","role","status","session_epoch","last_login_at","wechat","trial_ends_at","deletion_started_at"]],
  ["uploads", ["id","user_id","subject","file_keys","file_names","created_at"]],
  ["upload_objects", ["key","user_id","multipart_id"]],
  ["mistakes", ["id","upload_id","user_id","subject","question","incorrect_answer","correct_answer","reasoning","knowledge_point","page_number","source_name","similar_questions","created_at"]],
  ["practice_papers", ["id","user_id","subject","unit_name","grade_level","questions","answers","grading","created_at","graded_at"]],
  ["knowledge_units", ["user_id","subject","knowledge_point","unit_name","guide","updated_at"]],
  ["essay_reports", ["id","user_id","prompt_text","original_text","grade_level","report_json","created_at"]],
];
await client.connect();
try {
  await client.query("BEGIN");
  let complete = false;
  try {
    for (const table of ["uploads", "upload_objects", "mistakes", "practice_papers", "knowledge_units", "essay_reports"]) {
      await client.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
    }
    for (const [table, columns] of tables) {
      const present = source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if (!present) continue;
      const rows = source.prepare(`SELECT * FROM ${table}`).all();
      for (const row of rows) {
        const values = columns.map(column => {
          const value = row[column] ?? null;
          if (column === "guide" && value === "") return null;
          return value;
        });
        await client.query(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map((_, i) => "$" + (i + 1)).join(",")})`, values);
      }
      console.log({ migratedTable: table, realRecords: rows.length });
    }
    for (const table of ["uploads", "upload_objects", "mistakes", "practice_papers", "knowledge_units", "essay_reports"]) {
      await client.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
    }
    await client.query("COMMIT");
    complete = true;
  } finally {
    if (!complete) await client.query("ROLLBACK");
  }
} finally {
  source.close();
  await client.end();
}

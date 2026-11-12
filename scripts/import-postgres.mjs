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
    const hasProfiles=(await client.query("SELECT to_regclass('learning_profiles') IS NOT NULL AS present")).rows[0].present;
    const hasLearning=(await client.query("SELECT to_regclass('learning_attempts') IS NOT NULL AS present")).rows[0].present;
    if(hasLearning)await client.query('ALTER TABLE learning_attempts DISABLE TRIGGER USER');
    const hasSubjectHistory=(await client.query("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='uploads' AND column_name='original_subject') AS present")).rows[0].present;
    const subjectAliases={小学数学:'数学',初中数学:'数学',高中数学:'数学',小学语文:'语文',初中语文:'语文',高中语文:'语文',小学英语:'英语',初中英语:'英语',高中英语:'英语',政治:'道德与法治'};
    if(hasProfiles)await client.query('ALTER TABLE learning_profiles DISABLE TRIGGER USER');
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
        const insertColumns=[...columns];
        if(table==='users'&&row.paid_ends_at!==undefined){insertColumns.push('paid_ends_at');values.push(row.paid_ends_at);}
        if(hasProfiles&&table!=='users'){insertColumns.push('profile_id');values.push('default:'+row.user_id);}
        if(hasSubjectHistory&&['uploads','mistakes'].includes(table))values[columns.indexOf('subject')]=subjectAliases[row.subject]||row.subject;
        if(hasSubjectHistory&&table==='uploads'){insertColumns.push('original_subject');values.push(row.original_subject??row.subject);}
        if(table==='mistakes')for(const field of ['question_bounds','reflection'])if(row[field]!==undefined){insertColumns.push(field);values.push(row[field]);}
        if(table==='uploads')for(const field of ['ocr_result','analysis_result','analysis_status','analysis_error','analysis_started_at','analysis_attempt_id'])if(row[field]!==undefined){insertColumns.push(field);values.push(row[field]);}
        await client.query(`INSERT INTO ${table} (${insertColumns.join(",")}) VALUES (${insertColumns.map((_, i) => "$" + (i + 1)).join(",")})`, values);
        if(hasProfiles&&table==='users')await client.query("INSERT INTO learning_profiles(id,user_id,name,is_default,created_at) VALUES($1,$2,'默认档案',true,$3)",['default:'+row.id,row.id,row.created_at]);
        if(hasLearning&&table==='practice_papers'&&row.graded_at)await client.query("INSERT INTO learning_attempts(id,user_id,profile_id,paper_id,answers,grading,source,status,grading_source,started_at,completed_at) SELECT md5('legacy:'||id)::uuid::text,user_id,profile_id,id,answers,grading,'unit','completed','legacy',created_at,graded_at FROM practice_papers WHERE id=$1",[row.id]);
      }
      console.log({ migratedTable: table, realRecords: rows.length });
    }
    if(hasProfiles)await client.query('ALTER TABLE learning_profiles ENABLE TRIGGER USER');
    if(hasLearning)await client.query('ALTER TABLE learning_attempts ENABLE TRIGGER USER');
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

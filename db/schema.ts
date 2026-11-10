import { check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const time = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
  role: text("role").notNull().default("user"),
  status: text("status").notNull().default("active"),
  sessionEpoch: integer("session_epoch").notNull().default(0),
  lastLoginAt: time("last_login_at"),
  wechat: text("wechat"),
  trialEndsAt: time("trial_ends_at"),
  paidEndsAt: time("paid_ends_at"),
  deletionStartedAt: time("deletion_started_at"),
}, table => [
  check("users_role_check", sql`${table.role} IN ('user', 'admin')`),
  check("users_status_check", sql`${table.status} IN ('active', 'disabled')`),
  check("users_session_epoch_check", sql`${table.sessionEpoch} >= 0`),
  check("users_deletion_status_check", sql`${table.deletionStartedAt} IS NULL OR ${table.status} = 'disabled'`),
  index("users_created_idx").on(table.createdAt, table.id),
]);

export const uploads = pgTable("uploads", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  fileKeys: jsonb("file_keys").$type<string[]>().notNull(),
  fileNames: jsonb("file_names").$type<string[]>().notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
}, table => [
  uniqueIndex("uploads_id_user_idx").on(table.id, table.userId),
  index("uploads_user_created_idx").on(table.userId, table.createdAt, table.id),
  check("uploads_file_keys_array", sql`jsonb_typeof(${table.fileKeys}) = 'array'`),
  check("uploads_file_names_array", sql`jsonb_typeof(${table.fileNames}) = 'array'`),
]);

// 图片内容写入之前持久保存 multipart 标识，删除账号时据此中止上传。
export const uploadObjects = pgTable("upload_objects", {
  key: text("key").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  multipartId: text("multipart_id").notNull(),
}, table => [index("upload_objects_user_idx").on(table.userId)]);

export const mistakes = pgTable("mistakes", {
  id: text("id").primaryKey(),
  uploadId: text("upload_id").notNull().references(() => uploads.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  question: text("question").notNull(),
  // 题目在原图上的区域，千分比坐标 [left, top, right, bottom]；旧数据留空。
  questionBounds: jsonb("question_bounds").notNull().default([]),
  incorrectAnswer: text("incorrect_answer").notNull(),
  correctAnswer: text("correct_answer").notNull(),
  reasoning: text("reasoning").notNull(),
  knowledgePoint: text("knowledge_point").notNull(),
  pageNumber: integer("page_number").notNull(),
  sourceName: text("source_name").notNull(),
  similarQuestions: jsonb("similar_questions").notNull().default([]),
  createdAt: time("created_at").notNull().defaultNow(),
}, table => [
  foreignKey({ name: "mistakes_upload_user_fk", columns: [table.uploadId, table.userId], foreignColumns: [uploads.id, uploads.userId] }).onDelete("cascade"),
  index("mistakes_user_created_idx").on(table.userId, table.createdAt, table.id),
  index("mistakes_upload_idx").on(table.uploadId),
  index("mistakes_subject_created_idx").on(table.subject, table.createdAt, table.id),
  check("mistakes_page_number_check", sql`${table.pageNumber} > 0`),
  check("mistakes_similar_array", sql`jsonb_typeof(${table.similarQuestions}) = 'array'`),
  check("mistakes_bounds_array", sql`jsonb_typeof(${table.questionBounds}) = 'array'`),
]);

export const practicePapers = pgTable("practice_papers", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  unitName: text("unit_name").notNull(),
  gradeLevel: text("grade_level").notNull().default(""),
  questions: jsonb("questions").notNull(),
  answers: jsonb("answers").notNull().default([]),
  grading: jsonb("grading").notNull().default([]),
  createdAt: time("created_at").notNull().defaultNow(),
  gradedAt: time("graded_at"),
}, table => [index("practice_papers_user_created_idx").on(table.userId, table.createdAt, table.id)]);

export const knowledgeUnits = pgTable("knowledge_units", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  knowledgePoint: text("knowledge_point").notNull(),
  unitName: text("unit_name").notNull().default(""),
  guide: jsonb("guide"),
  updatedAt: time("updated_at").notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.userId, table.subject, table.knowledgePoint] })]);

export const essayReports = pgTable("essay_reports", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  promptText: text("prompt_text").notNull().default(""),
  originalText: text("original_text").notNull(),
  gradeLevel: text("grade_level").notNull().default(""),
  reportJson: jsonb("report_json").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
}, table => [index("essay_reports_user_created_idx").on(table.userId, table.createdAt, table.id)]);

export const paymentOrders = pgTable("payment_orders", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  productId: text("product_id").notNull(),
  productName: text("product_name").notNull(),
  purpose: text("purpose").notNull().default("MEMBERSHIP"),
  amountCents: integer("amount_cents").notNull(),
  durationDays: integer("duration_days").notNull(),
  currency: text("currency").notNull().default("CNY"),
  source: text("source").notNull(),
  localOrderId: text("local_order_id").unique(),
  status: text("status").notNull().default("PENDING"),
  deliveryStatus: text("delivery_status").notNull().default("PENDING"),
  createdAt: time("created_at").notNull().defaultNow(),
  paidAt: time("paid_at"),
  gatewayRequestedAt: time("gateway_requested_at"),
  requestLeaseUntil: time("request_lease_until"),
}, table => [
  check("payment_orders_id_check", sql`${table.id} ~ '^ST_[a-f0-9]{32}$'`),
  check("payment_orders_amount_cents_check", sql`${table.amountCents} > 0`),
  check("payment_orders_duration_days_check", sql`(${table.purpose} = 'TEST' AND ${table.durationDays} = 0) OR (${table.purpose} = 'MEMBERSHIP' AND ${table.durationDays} > 0)`),
  check("payment_orders_purpose_check", sql`${table.purpose} IN ('MEMBERSHIP','TEST')`),
  check("payment_orders_test_amount_check", sql`${table.purpose} <> 'TEST' OR ${table.amountCents} BETWEEN 1 AND 10000`),
  check("payment_orders_currency_check", sql`${table.currency} = 'CNY'`),
  check("payment_orders_status_check", sql`${table.status} IN ('PENDING','PAID')`),
  check("payment_orders_delivery_status_check", sql`${table.deliveryStatus} IN ('PENDING','DELIVERED','REVIEW')`),
  check("payment_orders_paid_check", sql`(${table.status} = 'PAID') = (${table.paidAt} IS NOT NULL)`),
  check("payment_orders_delivery_check", sql`${table.deliveryStatus} = 'PENDING' OR ${table.status} = 'PAID'`),
  index("payment_orders_user_created_idx").on(table.userId, table.createdAt.desc()),
  uniqueIndex("payment_orders_pending_user_idx").on(table.userId, table.source, table.purpose, table.amountCents).where(sql`${table.status} = 'PENDING'`),
]);

export const paymentEvents = pgTable("payment_events", {
  orderId: text("order_id").notNull().references(() => paymentOrders.id),
  localOrderId: text("local_order_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  receivedAt: time("received_at").notNull().defaultNow(),
  processedAt: time("processed_at"),
}, table => [
  primaryKey({ columns: [table.orderId, table.localOrderId] }),
  check("payment_events_amount_cents_check", sql`${table.amountCents} > 0`),
]);

export const paymentDeliveries = pgTable("payment_deliveries", {
  orderId: text("order_id").primaryKey().references(() => paymentOrders.id),
  paidEndsAt: time("paid_ends_at").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
});

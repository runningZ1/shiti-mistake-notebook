import { sql } from "drizzle-orm";
import { check, pgTable, text, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./schema";

// Integrator: import/re-export this table in the primary schema and add profile_id
// references to business tables to match migration 0008. This file avoids shared-file edits.
export const learningProfiles = pgTable("learning_profiles", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  gradeLevel: text("grade_level").notNull().default(""),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, table => [
  uniqueIndex("learning_profiles_id_user_idx").on(table.id, table.userId),
  uniqueIndex("learning_profiles_default_idx").on(table.userId).where(sql`${table.isDefault}`),
  check("learning_profiles_name_check", sql`char_length(trim(${table.name})) BETWEEN 1 AND 40`),
  check("learning_profiles_grade_check", sql`char_length(${table.gradeLevel}) <= 30`),
]);

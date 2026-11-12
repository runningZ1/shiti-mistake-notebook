import { sql } from "drizzle-orm";
import { check, foreignKey, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./schema";
import { learningProfiles } from "./profile-schema";
import type { WorkspaceDraftPayload } from "../lib/workspace-drafts";

// Integrator: re-export in the primary Drizzle schema; SQL migration is authoritative.
export const workspaceDrafts = pgTable("workspace_drafts", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  profileId: text("profile_id").notNull(), draftKey: text("draft_key").notNull(),
  version: integer("version").notNull().default(1),
  payload: jsonb("payload").$type<WorkspaceDraftPayload>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.userId, table.profileId, table.draftKey] }),
  foreignKey({ name: "workspace_drafts_profile_user_fk", columns: [table.profileId, table.userId], foreignColumns: [learningProfiles.id, learningProfiles.userId] }).onDelete("cascade"),
  check("workspace_drafts_key_check", sql`${table.draftKey} ~ '^[a-z][a-z0-9-]{0,63}$'`),
  check("workspace_drafts_version_check", sql`${table.version} > 0`),
  check("workspace_drafts_payload_object", sql`jsonb_typeof(${table.payload}) = 'object'`),
]);

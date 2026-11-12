import { sql } from 'drizzle-orm';
import { pgTable,text,jsonb,integer,timestamp,date,foreignKey,unique,index,check,uniqueIndex,type AnyPgColumn } from 'drizzle-orm/pg-core';
import { users,practicePapers,essayReports } from './schema';
import { learningProfiles } from './profile-schema';
const time=(name:string)=>timestamp(name,{withTimezone:true,mode:'string'});
const owner=()=>({userId:text('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),profileId:text('profile_id').notNull()});
export const learningAttempts=pgTable('learning_attempts',{
 id:text('id').primaryKey(),...owner(),paperId:text('paper_id').notNull().references(()=>practicePapers.id,{onDelete:'cascade'}),
 answers:jsonb('answers').notNull(),grading:jsonb('grading').notNull().default(sql`'[]'::jsonb`),source:text('source').notNull().default('unit'),sourceId:text('source_id'),
 status:text('status').notNull().default('draft'),gradingSource:text('grading_source'),error:text('error'),startedAt:time('started_at').notNull().defaultNow(),completedAt:time('completed_at'),
},t=>[unique().on(t.id,t.userId,t.profileId),index('learning_attempts_scope').on(t.userId,t.profileId,t.paperId,t.startedAt.desc()),
 foreignKey({columns:[t.profileId,t.userId],foreignColumns:[learningProfiles.id,learningProfiles.userId]}).onDelete('cascade'),
 foreignKey({columns:[t.paperId,t.userId,t.profileId],foreignColumns:[practicePapers.id,practicePapers.userId,practicePapers.profileId]}).onDelete('cascade'),
 check('learning_attempts_status_check',sql`${t.status} IN ('draft','grading','completed','failed')`),check('learning_attempts_answers_check',sql`jsonb_typeof(${t.answers})='array'`),check('learning_attempts_grading_check',sql`jsonb_typeof(${t.grading})='array'`)]);
export const learningDrafts=pgTable('learning_drafts',{
 id:text('id').primaryKey(),...owner(),kind:text('kind').notNull(),sourceId:text('source_id').notNull(),payload:jsonb('payload').notNull(),revision:integer('revision').notNull().default(1),updatedAt:time('updated_at').notNull().defaultNow(),
},t=>[unique().on(t.userId,t.profileId,t.kind,t.sourceId),foreignKey({columns:[t.profileId,t.userId],foreignColumns:[learningProfiles.id,learningProfiles.userId]}).onDelete('cascade'),check('learning_drafts_kind_check',sql`${t.kind} IN ('practice','essay')`),check('learning_drafts_revision_check',sql`${t.revision}>0`)]);
export const learningReviews=pgTable('learning_reviews',{
 id:text('id').primaryKey(),...owner(),attemptId:text('attempt_id').notNull(),evidence:text('evidence').notNull(),state:text('state').notNull(),reviewOn:date('review_on'),createdAt:time('created_at').notNull().defaultNow(),
},t=>[uniqueIndex('learning_reviews_attempt_idx').on(t.attemptId),foreignKey({columns:[t.attemptId,t.userId,t.profileId],foreignColumns:[learningAttempts.id,learningAttempts.userId,learningAttempts.profileId]}).onDelete('cascade'),foreignKey({columns:[t.profileId,t.userId],foreignColumns:[learningProfiles.id,learningProfiles.userId]}).onDelete('cascade'),index('learning_reviews_scope').on(t.userId,t.profileId,t.reviewOn),check('learning_reviews_state_check',sql`${t.state} IN ('needs_correction','needs_review','reviewed')`),check('learning_reviews_evidence_check',sql`length(${t.evidence}) BETWEEN 1 AND 4000`)]);
export const learningEssayVersions=pgTable('learning_essay_versions',{
 id:text('id').primaryKey(),...owner(),parentId:text('parent_id'),kind:text('kind').notNull(),promptText:text('prompt_text').notNull(),originalText:text('original_text').notNull(),gradeLevel:text('grade_level').notNull().default(''),analysisError:text('analysis_error'),createdAt:time('created_at').notNull().defaultNow(),
},t=>[unique().on(t.id,t.userId,t.profileId),foreignKey({columns:[t.parentId,t.userId,t.profileId],foreignColumns:[t.id as AnyPgColumn,t.userId as AnyPgColumn,t.profileId as AnyPgColumn]}),foreignKey({columns:[t.profileId,t.userId],foreignColumns:[learningProfiles.id,learningProfiles.userId]}).onDelete('cascade'),check('learning_essay_versions_kind_check',sql`${t.kind} IN ('original','revision')`),check('learning_essay_versions_check',sql`(${t.kind}='original' AND ${t.parentId} IS NULL) OR (${t.kind}='revision' AND ${t.parentId} IS NOT NULL)`)]);
export const learningEssayReports=pgTable('learning_essay_reports',{
 reportId:text('report_id').primaryKey().references(()=>essayReports.id,{onDelete:'cascade'}),versionId:text('version_id').notNull(),...owner(),
},t=>[uniqueIndex('learning_essay_reports_version_idx').on(t.versionId),foreignKey({columns:[t.versionId,t.userId,t.profileId],foreignColumns:[learningEssayVersions.id,learningEssayVersions.userId,learningEssayVersions.profileId]}).onDelete('cascade'),foreignKey({columns:[t.reportId,t.userId,t.profileId],foreignColumns:[essayReports.id,essayReports.userId,essayReports.profileId]}).onDelete('cascade'),foreignKey({columns:[t.profileId,t.userId],foreignColumns:[learningProfiles.id,learningProfiles.userId]}).onDelete('cascade')]);
export const learningPaperSources=pgTable('learning_paper_sources',{
 paperId:text('paper_id').primaryKey().references(()=>practicePapers.id,{onDelete:'cascade'}),...owner(),source:text('source').notNull(),sourceId:text('source_id').notNull(),
},t=>[foreignKey({columns:[t.paperId,t.userId,t.profileId],foreignColumns:[practicePapers.id,practicePapers.userId,practicePapers.profileId]}).onDelete('cascade'),foreignKey({columns:[t.profileId,t.userId],foreignColumns:[learningProfiles.id,learningProfiles.userId]}).onDelete('cascade'),check('learning_paper_sources_source_check',sql`${t.source} IN ('original','similar')`)]);

export const learningReviewEvents=pgTable('learning_review_events',{
 id:text('id').primaryKey(),reviewId:text('review_id').notNull().references(()=>learningReviews.id,{onDelete:'cascade'}),...owner(),evidence:text('evidence').notNull(),state:text('state').notNull(),reviewOn:date('review_on'),createdAt:time('created_at').notNull().defaultNow(),
},t=>[foreignKey({columns:[t.profileId,t.userId],foreignColumns:[learningProfiles.id,learningProfiles.userId]}).onDelete('cascade'),check('learning_review_events_state_check',sql`${t.state} IN ('needs_correction','needs_review','reviewed')`)]);

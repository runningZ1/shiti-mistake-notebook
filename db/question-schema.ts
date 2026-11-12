import {pgTable,text,integer,jsonb,boolean,timestamp,primaryKey,uniqueIndex,index} from 'drizzle-orm/pg-core';
import {users,uploads} from './schema';
import {learningProfiles} from './profile-schema';
const time=(n:string)=>timestamp(n,{withTimezone:true,mode:'string'});
export const uploadQuestions=pgTable('upload_questions',{
 id:text('id').primaryKey(),uploadId:text('upload_id').notNull().references(()=>uploads.id,{onDelete:'cascade'}),userId:text('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),profileId:text('profile_id').notNull().references(()=>learningProfiles.id),
 pageNumber:integer('page_number').notNull(),sourceIndex:integer('source_index'),originalOcr:jsonb('original_ocr'),version:integer('version').notNull().default(1),question:text('question').notNull().default(''),studentAnswer:text('student_answer').notNull().default(''),referenceAnswer:text('reference_answer').notNull().default(''),referenceSource:text('reference_source').notNull().default('照片识别'),bounds:jsonb('bounds').notNull().default([]),state:text('state').notNull().default('pending'),hasFigure:boolean('has_figure').notNull().default(false),createdAt:time('created_at').notNull().defaultNow(),updatedAt:time('updated_at').notNull().defaultNow(),
},t=>[uniqueIndex('upload_questions_source_idx').on(t.uploadId,t.pageNumber,t.sourceIndex),index('upload_questions_scope_idx').on(t.userId,t.profileId,t.uploadId)]);
export const questionVersions=pgTable('question_versions',{
 questionId:text('question_id').notNull().references(()=>uploadQuestions.id,{onDelete:'cascade'}),version:integer('version').notNull(),content:jsonb('content').notNull(),createdAt:time('created_at').notNull().defaultNow(),
},t=>[primaryKey({columns:[t.questionId,t.version]})]);
export const questionReports=pgTable('question_reports',{
 id:text('id').primaryKey(),questionId:text('question_id').notNull().references(()=>uploadQuestions.id,{onDelete:'cascade'}),inputVersion:integer('input_version').notNull(),report:jsonb('report').notNull(),createdAt:time('created_at').notNull().defaultNow(),
});
export const processingJobs=pgTable('processing_jobs',{
 id:text('id').primaryKey(),uploadId:text('upload_id').notNull().references(()=>uploads.id,{onDelete:'cascade'}),userId:text('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),profileId:text('profile_id').notNull().references(()=>learningProfiles.id),kind:text('kind').notNull(),status:text('status').notNull().default('queued'),inputVersions:jsonb('input_versions').notNull().default({}),attempt:integer('attempt').notNull().default(0),leaseUntil:time('lease_until'),error:text('error'),createdAt:time('created_at').notNull().defaultNow(),updatedAt:time('updated_at').notNull().defaultNow(),
});
export const questionEditDrafts=pgTable('question_edit_drafts',{
 uploadId:text('upload_id').notNull().references(()=>uploads.id,{onDelete:'cascade'}),userId:text('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),profileId:text('profile_id').notNull().references(()=>learningProfiles.id),draftKey:text('draft_key').notNull(),revision:integer('revision').notNull().default(1),payload:jsonb('payload').notNull(),updatedAt:time('updated_at').notNull().defaultNow(),
},t=>[primaryKey({columns:[t.uploadId,t.draftKey]})]);

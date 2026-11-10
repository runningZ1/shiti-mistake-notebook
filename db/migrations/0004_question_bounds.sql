ALTER TABLE "mistakes" ADD COLUMN "question_bounds" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "mistakes" ADD CONSTRAINT "mistakes_bounds_array" CHECK (jsonb_typeof("mistakes"."question_bounds") = 'array');

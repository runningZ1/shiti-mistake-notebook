ALTER TABLE "mistakes" ADD COLUMN "reflection" text DEFAULT '' NOT NULL;
ALTER TABLE "mistakes" ADD CONSTRAINT "mistakes_reflection_length" CHECK (char_length("mistakes"."reflection") <= 1000);

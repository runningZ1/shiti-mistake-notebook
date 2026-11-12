ALTER TABLE uploads ADD COLUMN ocr_result jsonb;
ALTER TABLE uploads ADD CONSTRAINT uploads_ocr_result_object
  CHECK (ocr_result IS NULL OR jsonb_typeof(ocr_result) = 'object');

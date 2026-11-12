-- Preserve original upload labels and normalize only explicitly known aliases.
ALTER TABLE uploads DISABLE TRIGGER uploads_require_active_user;
ALTER TABLE mistakes DISABLE TRIGGER mistakes_require_active_user;
UPDATE uploads SET original_subject=subject WHERE original_subject IS NULL;
UPDATE uploads SET subject=CASE
 WHEN subject IN ('小学数学','初中数学','高中数学') THEN '数学'
 WHEN subject IN ('小学语文','初中语文','高中语文') THEN '语文'
 WHEN subject IN ('小学英语','初中英语','高中英语') THEN '英语'
 WHEN subject='政治' THEN '道德与法治' ELSE subject END;
UPDATE mistakes SET subject=CASE
 WHEN subject IN ('小学数学','初中数学','高中数学') THEN '数学'
 WHEN subject IN ('小学语文','初中语文','高中语文') THEN '语文'
 WHEN subject IN ('小学英语','初中英语','高中英语') THEN '英语'
 WHEN subject='政治' THEN '道德与法治' ELSE subject END;

ALTER TABLE uploads ENABLE TRIGGER uploads_require_active_user;
ALTER TABLE mistakes ENABLE TRIGGER mistakes_require_active_user;

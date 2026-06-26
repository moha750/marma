-- المدينة والجوال إجباريان على كل أرضية
-- البيانات الحالية فارغة، فلا حاجة لـ backfill قبل ALTER

ALTER TABLE public.fields
  ALTER COLUMN city  SET NOT NULL,
  ALTER COLUMN phone SET NOT NULL;

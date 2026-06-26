-- تفعيل امتداد btree_gist (المطلوب لقيد EXCLUSION على bookings لمنع تعارض المواعيد)
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
;
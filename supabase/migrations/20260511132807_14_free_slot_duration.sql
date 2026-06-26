-- استبدال القيد بأخر أوسع: أي مدة بين 15 و 480 دقيقة
ALTER TABLE public.working_periods
  DROP CONSTRAINT working_periods_slot_duration_minutes_check;

ALTER TABLE public.working_periods
  ADD CONSTRAINT working_periods_slot_duration_minutes_check
  CHECK (slot_duration_minutes >= 15 AND slot_duration_minutes <= 480);
;
-- ⚠️ مهاجرة هدم — تحذف كل بطاقات الولاء وما تعلّق بها حذفاً نهائياً.
--
-- سببها أن النموذج انقلب في 20260809140000: البطاقات القائمة صدرت تلقائياً
-- بلا علم أصحابها، وأختامها مُنحت بلا موافقة أحد. إبقاؤها يعني أرصدةً لم
-- يوافق عليها المالك في نظامٍ صار كلّه موافقة — فتُصفَّر البداية.
--
-- ما يُحذف: البطاقات · دفتر الحركات · القسائم · الطلبات المعلّقة.
-- وما يُفكّ: ارتباط الحجوزات بقسائمها، ووسم «مُنح ختمه» عنها كلها كي لا
-- يمنع المكنسةَ من رؤيتها لاحقاً.
--
-- البرنامج نفسه (الاسم والقواعد والهوية) لا يُمسّ.

begin;

-- ١) فُكّ الحجوزات عن القسائم واسترجع أسعارها الأصلية قبل حذف القسائم،
--    وإلا بقيت حجوزاتٌ مخصومةٌ بقسيمةٍ لا وجود لها.
update public.bookings b
   set total_price       = coalesce(b.total_price, 0) + coalesce(b.discount_amount, 0),
       discount_amount   = 0,
       loyalty_reward_id = null
 where b.loyalty_reward_id is not null;

-- ٢) امسح وسم «مُنح ختمه» عن كل الحجوزات — البداية صفرٌ حقيقي
update public.bookings set loyalty_awarded_at = null
 where loyalty_awarded_at is not null;

-- ٣) الحذف. الترتيب لا يهمّ (كلّها cascade من loyalty_cards) لكنه صريحٌ
--    عمداً: من يقرأ هذه المهاجرة يجب أن يرى ما يذهب، لا أن يستنتجه.
delete from public.loyalty_pending_stamps;
delete from public.loyalty_rewards;
delete from public.loyalty_transactions;
delete from public.loyalty_cards;

commit;

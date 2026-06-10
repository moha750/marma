// Offers API — عروض/خصومات زمنية (field_offers + offer_targets). RLS تعزل المستأجر.
// كل هدف (offer_target) يحمل ملعبه ويومه ووقته، فيمكن خلط مواعيد ملاعب مختلفة في عرض واحد.
window.offersApi = (function () {
  const sb = () => window.sb;
  const COLS = 'id, label, discount_percent, fixed_price, start_date, end_date, active, created_at';

  async function listOffers() {
    const { data, error } = await sb()
      .from('field_offers').select(COLS).order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function listOfferTargets() {
    const { data, error } = await sb()
      .from('offer_targets').select('offer_id, field_id, weekday, start_time, end_time');
    if (error) throw error;
    return data || [];
  }

  // حفظ عرض + أهدافه ذرّيًّا. targets: [{field_id,weekday,start_time,end_time}]
  async function saveOffer(o) {
    const { data, error } = await sb().rpc('save_offer', {
      p_id: o.id || null,
      p_label: o.label,
      p_discount: o.discount_percent ?? null,
      p_fixed: o.fixed_price ?? null,
      p_start_date: o.start_date || null,
      p_end_date: o.end_date || null,
      p_targets: o.targets || []
    });
    if (error) throw error;
    return data;
  }

  async function setOfferActive(id, active) {
    const { error } = await sb().from('field_offers').update({ active }).eq('id', id);
    if (error) throw error;
  }

  async function deleteOffer(id) {
    const { error } = await sb().from('field_offers').delete().eq('id', id);
    if (error) throw error;
  }

  return { listOffers, listOfferTargets, saveOffer, setOfferActive, deleteOffer };
})();

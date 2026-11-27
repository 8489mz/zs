import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/components/system-alert';
import { vanSalesApi, VanCustomerItineraryItem } from '../api/van-sales.api';

interface VanTradeSurveyModalProps {
  customer: VanCustomerItineraryItem | null;
  tripId?: number;
  onClose: () => void;
  onSuccess?: () => void;
}

export const VanTradeSurveyModal: React.FC<VanTradeSurveyModalProps> = ({
  customer,
  tripId,
  onClose,
  onSuccess,
}) => {
  const { t } = useTranslation();
  const [surveyType, setSurveyType] = useState<'cooler_inspection' | 'competitor_survey'>('cooler_inspection');
  const [assetId, setAssetId] = useState('');
  const [assetCondition, setAssetCondition] = useState('good');
  const [isPure, setIsPure] = useState(true);
  const [temperature, setTemperature] = useState('');
  const [cleanliness, setCleanliness] = useState(5);
  const [competitorName, setCompetitorName] = useState('');
  const [competitorProduct, setCompetitorProduct] = useState('');
  const [competitorPrice, setCompetitorPrice] = useState('');
  const [competitorOffers, setCompetitorOffers] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!customer) return null;

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      await vanSalesApi.recordTradeSurvey({
        tripId: tripId || undefined,
        customerId: customer.customerId,
        surveyType,
        assetId: surveyType === 'cooler_inspection' ? assetId || 'FRIDGE-01' : undefined,
        assetName: surveyType === 'cooler_inspection' ? 'ثلاجة عرض معارة' : undefined,
        assetCondition: surveyType === 'cooler_inspection' ? assetCondition : undefined,
        isPureCompanyProducts: surveyType === 'cooler_inspection' ? isPure : true,
        temperatureCelsius: surveyType === 'cooler_inspection' && temperature ? Number(temperature) : undefined,
        cleanlinessRating: surveyType === 'cooler_inspection' ? cleanliness : undefined,
        competitorName: surveyType === 'competitor_survey' ? competitorName : undefined,
        competitorProduct: surveyType === 'competitor_survey' ? competitorProduct : undefined,
        competitorPrice: surveyType === 'competitor_survey' && competitorPrice ? Number(competitorPrice) : undefined,
        competitorOfferDetails: surveyType === 'competitor_survey' ? competitorOffers : undefined,
        notes: notes.trim() || undefined,
      });

      toast.success(
        surveyType === 'cooler_inspection'
          ? `تم توثيق تفتيش الثلاجة للمحل: ${customer.customerName}`
          : `تم توثيق استطلاع أسعار المنافس بنجاح`,
      );
      onSuccess?.();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'فشل توثيق استطلاع الميرشندايز');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <StandardDialog
      open={true}
      onClose={onClose}
      title={t('delivery_reps.van_trade_survey_modal.s0', "استطلاع الميرشندايز وتفتيش الأصول")}
      subtitle={`العميل: ${customer.customerName}`}
      badge={t('delivery_reps.van_trade_survey_modal.s1', "الميرشندايز")}
      width="min(540px, 96vw)"
      footerActions={
        <StandardDialogFooter
          onClose={onClose}
          cancelText={t('delivery_reps.van_trade_survey_modal.s2', "إلغاء")}
          extraActions={
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={isSubmitting}
              style={{
                backgroundColor: '#170e5e',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '12.5px',
                height: '38px',
              }}
            >
              {isSubmitting ? t('delivery_reps.van_trade_survey_modal.s3', "جاري الحفظ...") : t('delivery_reps.van_trade_survey_modal.s4', "حفظ وإرسال التفتيش")}
            </Button>
          }
        />
      }
    >
      <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* Type Toggle */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={() => setSurveyType('cooler_inspection')}
            style={{
              flex: 1,
              padding: '8px',
              borderRadius: '8px',
              border: surveyType === 'cooler_inspection' ? '1px solid #170e5e' : '1px solid #cbd5e1',
              backgroundColor: surveyType === 'cooler_inspection' ? '#170e5e' : '#ffffff',
              color: surveyType === 'cooler_inspection' ? '#ffffff' : '#334155',
              fontWeight: 700,
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            {t('delivery_reps.van_trade_survey_modal.s5', "تفتيش ثلاجة وأصل الشركة")}
          </button>
          <button
            type="button"
            onClick={() => setSurveyType('competitor_survey')}
            style={{
              flex: 1,
              padding: '8px',
              borderRadius: '8px',
              border: surveyType === 'competitor_survey' ? '1px solid #170e5e' : '1px solid #cbd5e1',
              backgroundColor: surveyType === 'competitor_survey' ? '#170e5e' : '#ffffff',
              color: surveyType === 'competitor_survey' ? '#ffffff' : '#334155',
              fontWeight: 700,
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            {t('delivery_reps.van_trade_survey_modal.s6', "رصد أسعار وعروض المنافسين")}
          </button>
        </div>

        {/* Cooler Inspection Form */}
        {surveyType === 'cooler_inspection' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>
                  {t('delivery_reps.van_trade_survey_modal.s7', "كود / باركود الثلاجة")}
                </label>
                <input
                  type="text"
                  placeholder={t('delivery_reps.van_trade_survey_modal.s8', "مثال: REF-0042")}
                  value={assetId}
                  onChange={(e) => setAssetId(e.target.value)}
                  style={{
                    width: '100%',
                    height: '34px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    padding: '0 10px',
                    fontSize: '12px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>
                  {t('delivery_reps.van_trade_survey_modal.s9', "الحالة الفنية للثلاجة")}
                </label>
                <select
                  value={assetCondition}
                  onChange={(e) => setAssetCondition(e.target.value)}
                  style={{
                    width: '100%',
                    height: '34px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    padding: '0 8px',
                    fontSize: '12px',
                    backgroundColor: '#ffffff',
                  }}
                >
                  <option value="excellent">{t('delivery_reps.van_trade_survey_modal.s10', "ممتازة ونظيفة")}</option>
                  <option value="good">{t('delivery_reps.van_trade_survey_modal.s11', "جيدة وتعمل بكفاءة")}</option>
                  <option value="needs_maintenance">{t('delivery_reps.van_trade_survey_modal.s12', "تحتاج صيانة / تبريد ضعيف")}</option>
                  <option value="damaged">{t('delivery_reps.van_trade_survey_modal.s13', "تالفة وبها كسر")}</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>
                  {t('delivery_reps.van_trade_survey_modal.s14', "درجة الحرارة التقديرية (°م)")}
                </label>
                <input
                  type="number"
                  placeholder={t('delivery_reps.van_trade_survey_modal.s15', "مثال: 4")}
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                  style={{
                    width: '100%',
                    height: '34px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    padding: '0 10px',
                    fontSize: '12px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>
                  {t('delivery_reps.van_trade_survey_modal.s16', "تقييم النظافة (1 إلى 5)")}
                </label>
                <select
                  value={cleanliness}
                  onChange={(e) => setCleanliness(Number(e.target.value))}
                  style={{
                    width: '100%',
                    height: '34px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    padding: '0 8px',
                    fontSize: '12px',
                    backgroundColor: '#ffffff',
                  }}
                >
                  <option value={5}>{t('delivery_reps.van_trade_survey_modal.s17', "5 نجوم (نظيفة ومرتبة جداً)")}</option>
                  <option value={4}>{t('delivery_reps.van_trade_survey_modal.s18', "4 نجوم (نظيفة)")}</option>
                  <option value={3}>{t('delivery_reps.van_trade_survey_modal.s19', "3 نجوم (متوسطة)")}</option>
                  <option value={2}>{t('delivery_reps.van_trade_survey_modal.s20', "2 نجوم (تحتاج تنظيف)")}</option>
                  <option value={1}>{t('delivery_reps.van_trade_survey_modal.s21', "1 نجمة (سيئة)")}</option>
                </select>
              </div>
            </div>

            {/* Pure company products check */}
            <div
              style={{
                backgroundColor: isPure ? '#f0fdf4' : '#fef2f2',
                border: isPure ? '1px solid #bbf7d0' : '1px solid #fecaca',
                borderRadius: '8px',
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: isPure ? '#166534' : '#991b1b' }}>
                  {isPure ? t('delivery_reps.van_trade_survey_modal.s22', "الثلاجة مقتصرة على منتجاتنا فقط (Pure Cooler)") : t('delivery_reps.van_trade_survey_modal.s23', "مخالفة: وضع منتجات منافسة داخل الثلاجة")}
                </div>
                <div style={{ fontSize: '10.5px', color: isPure ? '#15803d' : '#b91c1c' }}>
                  {t('delivery_reps.van_trade_survey_modal.s24', "يُمنع التاجر من وضع بضاعة شركات أخرى داخل ثلاجة الشركة")}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsPure(!isPure)}
                style={{
                  padding: '5px 12px',
                  borderRadius: '6px',
                  border: isPure ? '1px solid #16a34a' : '1px solid #dc2626',
                  backgroundColor: '#ffffff',
                  color: isPure ? '#16a34a' : '#dc2626',
                  fontSize: '11px',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                {isPure ? t('delivery_reps.van_trade_survey_modal.s25', "نقية 100%") : t('delivery_reps.van_trade_survey_modal.s26', "يوجد منافس")}
              </button>
            </div>
          </div>
        )}

        {/* Competitor Survey Form */}
        {surveyType === 'competitor_survey' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>
                  {t('delivery_reps.van_trade_survey_modal.s27', "اسم الشركة / البراند المنافس")}
                </label>
                <input
                  type="text"
                  placeholder={t('delivery_reps.van_trade_survey_modal.s28', "مثال: المراعي / كوكاكولا")}
                  value={competitorName}
                  onChange={(e) => setCompetitorName(e.target.value)}
                  style={{
                    width: '100%',
                    height: '34px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    padding: '0 10px',
                    fontSize: '12px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>
                  {t('delivery_reps.van_trade_survey_modal.s29', "اسم صنف المنافس")}
                </label>
                <input
                  type="text"
                  placeholder={t('delivery_reps.van_trade_survey_modal.s30', "مثال: حليب 1 لتر")}
                  value={competitorProduct}
                  onChange={(e) => setCompetitorProduct(e.target.value)}
                  style={{
                    width: '100%',
                    height: '34px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    padding: '0 10px',
                    fontSize: '12px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>
                {t('delivery_reps.van_trade_survey_modal.s31', "سعر بيع المنافس للتاجر (ج.م)")}
              </label>
              <input
                type="number"
                placeholder={t('delivery_reps.van_trade_survey_modal.s32', "السعر بالجنيه...")}
                value={competitorPrice}
                onChange={(e) => setCompetitorPrice(e.target.value)}
                style={{
                  width: '100%',
                  height: '34px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  padding: '0 10px',
                  fontSize: '12px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>
                {t('delivery_reps.van_trade_survey_modal.s33', "تفاصيل عروض وخصومات المنافس بالمنطقة")}
              </label>
              <input
                type="text"
                placeholder={t('delivery_reps.van_trade_survey_modal.s34', "مثال: بونص 2 كرتونة على كل 10 كراتين...")}
                value={competitorOffers}
                onChange={(e) => setCompetitorOffers(e.target.value)}
                style={{
                  width: '100%',
                  height: '34px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  padding: '0 10px',
                  fontSize: '12px',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
        )}

        {/* Notes */}
        <div>
          <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>
            {t('delivery_reps.van_trade_survey_modal.s35', "ملاحظات إضافية للمشرف وإدارة التسويق")}
          </label>
          <textarea
            rows={2}
            placeholder={t('delivery_reps.van_trade_survey_modal.s36', "اكتب ملاحظاتك الميدانية...")}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{
              width: '100%',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              padding: '8px 10px',
              fontSize: '12px',
              boxSizing: 'border-box',
              resize: 'none',
            }}
          />
        </div>
      </div>
    </StandardDialog>
  );
};

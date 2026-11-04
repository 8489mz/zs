import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { toast } from '@/shared/components/system-alert';
import { maritimeApi, MaritimeJob } from '../../api/maritime-freight.api';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Field } from '@/shared/ui/field';

interface Props {
  job: MaritimeJob;
  onUpdated: () => void;
}

const PRESET_CHARGES = [
  { code: 'O/F', nameAr: 'نولون بحري أساسي', nameEn: 'Base Ocean Freight', isLocal: false },
  { code: 'BAF', nameAr: 'تعديل أسعار الوقود', nameEn: 'Bunker Adjustment Factor', isLocal: false },
  { code: 'LSS', nameAr: 'رسوم خفض الانبعاثات الكربونية', nameEn: 'Low Sulphur Surcharge', isLocal: false },
  { code: 'THC', nameAr: 'رسوم تفريغ ومناولة محطة الميناء', nameEn: 'Terminal Handling Charge', isLocal: true },
  { code: 'BL_FEE', nameAr: 'رسوم إصدار بوليصة الشحن والبيان', nameEn: 'Bill of Lading Documentation Fee', isLocal: true },
  { code: 'SEAL', nameAr: 'رسوم السيل الملاحي والأمن', nameEn: 'Container Seal & Security Fee', isLocal: true },
  { code: 'INLAND', nameAr: 'نقل بري وترحيل للمستودع', nameEn: 'Inland Haulage / Trucking', isLocal: true },
  { code: 'CUSTOMS', nameAr: 'أتعاب ورسوم تخليص جمركي', nameEn: 'Customs Clearance & Handling', isLocal: true },
  { code: 'INSURANCE', nameAr: 'قسط تأمين بضائع ملاحي', nameEn: 'Marine Cargo Insurance Premium', isLocal: false },
];

export function JobChargesTab({ job, onUpdated }: Props) {
  const { t } = useTranslation();
  const [charges, setCharges] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [form, setForm] = useState({
    chargeCode: 'O/F',
    chargeNameAr: 'نولون بحري أساسي',
    chargeNameEn: 'Base Ocean Freight',
    currency: 'USD',
    costAmount: '',
    sellAmount: '',
    taxRatePercent: '0',
    isLocalCharge: false,
    isInvoiced: false,
  });

  useEffect(() => {
    fetchCharges();
  }, [job.id]);

  const fetchCharges = async () => {
    try {
      setLoading(true);
      const data = await maritimeApi.getJobCharges(job.id);
      setCharges(data || []);
    } catch {
      setCharges([]);
    } finally {
      setLoading(false);
    }
  };

  // INV-MARITIME-CHARGE-GRID-LINE-UPDATES: the grid sends the
  // backend's own DTO shape -- stored rows keep their id so the
  // backend updates line by line and preserves invoiced rows,
  // and rows arrive snake_case from getJobCharges, so both
  // casings are mapped. A new row never claims isInvoiced: the
  // flag comes only from the invoicing flow.
  const toChargePayload = (c: any) => ({
    id: c.id,
    chargeCode: c.charge_code || c.chargeCode,
    chargeNameAr: c.charge_name_ar || c.chargeNameAr,
    chargeNameEn: c.charge_name_en || c.chargeNameEn,
    currency: c.currency,
    costAmount: Number(c.cost_amount ?? c.costAmount ?? 0),
    sellAmount: Number(c.sell_amount ?? c.sellAmount ?? 0),
    profitAmount: Number(c.profit_amount ?? c.profitAmount ?? 0),
    isLocalCharge: Boolean(c.is_local_charge ?? c.isLocalCharge),
    taxRatePercent: Number(c.tax_rate_percent ?? c.taxRatePercent ?? 0),
    taxAmount: Number(c.tax_amount ?? c.taxAmount ?? 0),
    isInvoiced: Boolean(c.is_invoiced ?? c.isInvoiced ?? false),
  });

  const handleAddCharge = async () => {
    const cost = Number(form.costAmount || 0);
    const sell = Number(form.sellAmount || 0);
    const profit = sell - cost;
    const taxPct = Number(form.taxRatePercent || 0);
    const taxAmt = (sell * taxPct) / 100;

    const newCharge = {
      chargeCode: form.chargeCode,
      chargeNameAr: form.chargeNameAr,
      chargeNameEn: form.chargeNameEn,
      currency: form.currency,
      costAmount: cost,
      sellAmount: sell,
      profitAmount: profit,
      isLocalCharge: form.isLocalCharge,
      taxRatePercent: taxPct,
      taxAmount: taxAmt,
      isInvoiced: form.isInvoiced,
    };

    const updatedList = [...charges, newCharge].map(toChargePayload);
    try {
      setIsSaving(true);
      await maritimeApi.updateJobCharges(job.id, updatedList);
      toast.success('تمت إضافة بند الرسوم بنجاح');
      setShowAddModal(false);
      setForm({
        chargeCode: 'O/F',
        chargeNameAr: 'نولون بحري أساسي',
        chargeNameEn: 'Base Ocean Freight',
        currency: 'USD',
        costAmount: '',
        sellAmount: '',
        taxRatePercent: '0',
        isLocalCharge: false,
        isInvoiced: false,
      });
      fetchCharges();
      onUpdated();
    } catch (err: any) {
      toast.error(err.message || 'فشل حفظ بند الرسوم');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteCharge = async (index: number) => {
    const updatedList = charges.filter((_, idx) => idx !== index).map(toChargePayload);
    try {
      await maritimeApi.updateJobCharges(job.id, updatedList);
      toast.success('تم حذف بند الرسوم');
      fetchCharges();
      onUpdated();
    } catch (err: any) {
      toast.error(err.message || 'فشل الحذف');
    }
  };

  const totalCost = charges.reduce((sum, c) => sum + Number(c.cost_amount || c.costAmount || 0), 0);
  const totalSell = charges.reduce((sum, c) => sum + Number(c.sell_amount || c.sellAmount || 0), 0);
  const totalProfit = totalSell - totalCost;
  const marginPct = totalSell > 0 ? ((totalProfit / totalSell) * 100).toFixed(1) : '0.0';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }} dir="rtl">
      {/* 1. Header Banner & KPIs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '12px 16px', borderRadius: '10px', border: '1px solid #e2e8f0', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <div style={{ fontSize: '0.92rem', fontWeight: 800, color: '#170e5e' }}>
            {t('maritime_freight.job_details.job_charges_tab.s0', "شبكة تفصيل بنود التكلفة والإيراد والضرائب (Itemized Freight Charges Grid)")}
          </div>
          <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>
            {t('maritime_freight.job_details.job_charges_tab.s1', "تفكيك تكلفة النولون البحري/الجوي عن الرسوم المحلية بالميناء وضبط المعاملة الضريبية لكل بند")}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          style={{
            height: '34px',
            padding: '0 14px',
            background: '#170e5e',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            fontWeight: 700,
            fontSize: '0.8rem',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <AppIcons.Plus size={15} />
          <span>{t('maritime_freight.job_details.job_charges_tab.s2', "إضافة بند رسوم جديد")}</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px' }}>
          <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{t('maritime_freight.job_details.job_charges_tab.s3', "إجمالي التكلفة المباشرة (للخط والميناء)")}</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#b91c1c', marginTop: '2px', fontFamily: 'monospace' }}>
            ${totalCost.toLocaleString()}
          </div>
        </div>

        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px' }}>
          <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{t('maritime_freight.job_details.job_charges_tab.s4', "إجمالي سعر البيع (المفوتر للعميل)")}</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#15803d', marginTop: '2px', fontFamily: 'monospace' }}>
            ${totalSell.toLocaleString()}
          </div>
        </div>

        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px' }}>
          <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{t('maritime_freight.job_details.job_charges_tab.s5', "صافي ربح البنود (Gross Profit)")}</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#170e5e', marginTop: '2px', fontFamily: 'monospace' }}>
            ${totalProfit.toLocaleString()}
          </div>
        </div>

        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px' }}>
          <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{t('maritime_freight.job_details.job_charges_tab.s6', "نسبة هامش الربح")}</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0284c7', marginTop: '2px', fontFamily: 'monospace' }}>
            {marginPct}%
          </div>
        </div>
      </div>

      {/* Charges Table */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'right' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              <th style={{ padding: '8px 12px', fontWeight: 700 }}>{t('maritime_freight.job_details.job_charges_tab.s7', "كود الرسم")}</th>
              <th style={{ padding: '8px 12px', fontWeight: 700 }}>{t('maritime_freight.job_details.job_charges_tab.s8', "بيان الخدمة")}</th>
              <th style={{ padding: '8px 12px', fontWeight: 700 }}>{t('maritime_freight.job_details.job_charges_tab.s9', "العملة")}</th>
              <th style={{ padding: '8px 12px', fontWeight: 700 }}>{t('maritime_freight.job_details.job_charges_tab.s10', "التكلفة (Cost)")}</th>
              <th style={{ padding: '8px 12px', fontWeight: 700 }}>{t('maritime_freight.job_details.job_charges_tab.s11', "البيع (Sell)")}</th>
              <th style={{ padding: '8px 12px', fontWeight: 700 }}>{t('maritime_freight.job_details.job_charges_tab.s12', "الربح (Profit)")}</th>
              <th style={{ padding: '8px 12px', fontWeight: 700 }}>{t('maritime_freight.job_details.job_charges_tab.s13', "الضريبة %")}</th>
              <th style={{ padding: '8px 12px', fontWeight: 700, textAlign: 'center' }}>{t('maritime_freight.job_details.job_charges_tab.s14', "إجراء")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} style={{ padding: '30px', textAlign: 'center', color: '#64748b' }}>
                  {t('maritime_freight.job_details.job_charges_tab.s15', "جاري تحميل بنود الرسوم...")}
                </td>
              </tr>
            ) : charges.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: '30px', textAlign: 'center', color: '#64748b' }}>
                  {t('maritime_freight.job_details.job_charges_tab.s16', "لم يتم تسجيل بنود تفصيلية بعد. انقر على \"إضافة بند رسوم جديد\" لتفكيك التكلفة والإيراد.")}
                </td>
              </tr>
            ) : (
              charges.map((chg, idx) => (
                <tr key={chg.id || idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '8px 12px', fontWeight: 700, fontFamily: 'monospace', color: '#170e5e' }}>
                    {chg.charge_code || chg.chargeCode}
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <div style={{ fontWeight: 700 }}>{chg.charge_name_ar || chg.chargeNameAr}</div>
                    <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{chg.charge_name_en || chg.chargeNameEn}</div>
                  </td>
                  <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>
                    {chg.currency || 'USD'}
                  </td>
                  <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: '#b91c1c' }}>
                    ${Number(chg.cost_amount || chg.costAmount || 0).toLocaleString()}
                  </td>
                  <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#15803d' }}>
                    ${Number(chg.sell_amount || chg.sellAmount || 0).toLocaleString()}
                  </td>
                  <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#170e5e' }}>
                    ${Number(chg.profit_amount || chg.profitAmount || 0).toLocaleString()}
                  </td>
                  <td style={{ padding: '8px 12px', color: '#64748b' }}>
                    {Number(chg.tax_rate_percent || chg.taxRatePercent || 0) > 0 ? `${chg.tax_rate_percent || chg.taxRatePercent}%` : t('maritime_freight.job_details.job_charges_tab.s17', "معفى")}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                    <button
                      type="button"
                      onClick={() => handleDeleteCharge(idx)}
                      style={{ padding: '2px 6px', background: '#fee2e2', color: '#b91c1c', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.7rem' }}
                    >
                      {t('maritime_freight.job_details.job_charges_tab.s18', "حذف")}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal: Add Charge */}
      <StandardDialog
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        title={t('maritime_freight.job_details.job_charges_tab.s19', "إضافة بند رسوم وتكلفة جديد للشحنة")}
        subtitle={t('maritime_freight.job_details.job_charges_tab.s20', "تحديد التكلفة وسعر البيع والمعاملة الضريبية للرسم الملاحي أو المحلي")}
        width="540px"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Field label={t('maritime_freight.job_details.job_charges_tab.s21', "اختر من الرسوم الشائعة أو حدد مخصصاً")}>
            <select
              onChange={(e) => {
                const found = PRESET_CHARGES.find((p) => p.code === e.target.value);
                if (found) {
                  setForm({
                    ...form,
                    chargeCode: found.code,
                    chargeNameAr: found.nameAr,
                    chargeNameEn: found.nameEn,
                    isLocalCharge: found.isLocal,
                    taxRatePercent: found.isLocal ? '14' : '0',
                  });
                }
              }}
              style={{ width: '100%', height: '36px', padding: '0 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
            >
              <option value="">{t('maritime_freight.job_details.job_charges_tab.s22', "قوالب الرسوم الملاحية المعتمدة...")}</option>
              {PRESET_CHARGES.map((p) => (
                <option key={p.code} value={p.code}>{p.code} - {p.nameAr}</option>
              ))}
            </select>
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '10px' }}>
            <Field label={t('maritime_freight.job_details.job_charges_tab.s23', "كود الرسم")}>
              <input
                type="text"
                value={form.chargeCode}
                onChange={(e) => setForm({ ...form, chargeCode: e.target.value })}
                style={{ width: '100%', height: '36px', padding: '0 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem', fontFamily: 'monospace', fontWeight: 700 }}
              />
            </Field>

            <Field label={t('maritime_freight.job_details.job_charges_tab.s24', "اسم الرسم بالعربية")}>
              <input
                type="text"
                value={form.chargeNameAr}
                onChange={(e) => setForm({ ...form, chargeNameAr: e.target.value })}
                style={{ width: '100%', height: '36px', padding: '0 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
              />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <Field label={t('maritime_freight.job_details.job_charges_tab.s25', "التكلفة المباشرة (Cost)")}>
              <input
                type="number"
                placeholder="0.00"
                value={form.costAmount}
                onChange={(e) => setForm({ ...form, costAmount: e.target.value })}
                style={{ width: '100%', height: '36px', padding: '0 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
              />
            </Field>

            <Field label={t('maritime_freight.job_details.job_charges_tab.s26', "سعر البيع للعميل (Sell)")}>
              <input
                type="number"
                placeholder="0.00"
                value={form.sellAmount}
                onChange={(e) => setForm({ ...form, sellAmount: e.target.value })}
                style={{ width: '100%', height: '36px', padding: '0 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem', fontWeight: 700 }}
              />
            </Field>

            <Field label={t('maritime_freight.job_details.job_charges_tab.s27', "الضريبة %")}>
              <input
                type="number"
                placeholder="0"
                value={form.taxRatePercent}
                onChange={(e) => setForm({ ...form, taxRatePercent: e.target.value })}
                style={{ width: '100%', height: '36px', padding: '0 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
              />
            </Field>
          </div>
        </div>

        <StandardDialogFooter>
          <button
            type="button"
            onClick={() => setShowAddModal(false)}
            style={{ padding: '8px 16px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
          >
            {t('maritime_freight.job_details.job_charges_tab.s28', "إلغاء")}
          </button>
          <button
            type="button"
            onClick={handleAddCharge}
            disabled={isSaving}
            style={{ padding: '8px 20px', background: '#170e5e', color: '#ffffff', border: 'none', borderRadius: '6px', cursor: isSaving ? 'not-allowed' : 'pointer', fontWeight: 700 }}
          >
            {isSaving ? t('maritime_freight.job_details.job_charges_tab.s29', "جاري الحفظ...") : t('maritime_freight.job_details.job_charges_tab.s30', "إضافة البند")}
          </button>
        </StandardDialogFooter>
      </StandardDialog>
    </div>
  );
}

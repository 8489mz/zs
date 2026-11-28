import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import { FormSection } from '@/shared/components/form-section';
import { ShieldCheckIcon, RefreshCwIcon } from '@/shared/components/icons/AppIcons';

interface Props {
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  disabled: boolean;
}

const STRICT_PRESET = {
  antiTheftRequirePinForNoSale: true,
  antiTheftEnforceMandatoryReceiptPrint: true,
  antiTheftRequireElectronicPaymentRef: true,
  antiTheftLockWeightedManualEdit: true,
  antiTheftStrictTwoStepTransfers: true,
  antiTheftRequireManagerForWriteOff: true,
  antiTheftEnforceBlindStockCount: true,
  antiTheftEnforceBlindPurchaseReceiving: true,
  antiTheftBlockOverdueDeliveryRep: true,
  antiTheftInTransitAlertHours: 4,
  antiTheftCartClearAlertThreshold: 200,
  antiTheftWriteOffAlertThreshold: 500,
  antiTheftDefaultDeliveryCustodyCap: 0,
  antiTheftDeliveryOverdueHours: 20,
} as const;

const STANDARD_PRESET = {
  antiTheftRequirePinForNoSale: false,
  antiTheftEnforceMandatoryReceiptPrint: false,
  antiTheftRequireElectronicPaymentRef: false,
  antiTheftLockWeightedManualEdit: false,
  antiTheftStrictTwoStepTransfers: false,
  antiTheftRequireManagerForWriteOff: false,
  antiTheftEnforceBlindStockCount: false,
  antiTheftEnforceBlindPurchaseReceiving: false,
  antiTheftBlockOverdueDeliveryRep: false,
  antiTheftInTransitAlertHours: 4,
  antiTheftCartClearAlertThreshold: 200,
  antiTheftWriteOffAlertThreshold: 500,
  antiTheftDefaultDeliveryCustodyCap: 0,
  antiTheftDeliveryOverdueHours: 20,
} as const;

export function SalesInventoryAntiTheft({ form, disabled }: Props) {
  const applyPreset = (preset: Record<string, boolean | number>) => {
    for (const [key, val] of Object.entries(preset)) {
      form.setValue(key as any, val as any, { shouldDirty: true });
    }
  };

  return (
    <FormSection
      title="درع منع الخسائر ومكافحة السرقة الداخلية (Loss Prevention Shield)"
      description="ضوابط تشغيلية مشددة لنقاط البيع، التحويلات المخزنية، الجرد الأعمى، استلام المشتريات، وعهد المناديب. تُفعل حسب حاجة المنشأة دون تعطيل الإعدادات الافتراضية."
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          padding: '12px 14px',
          backgroundColor: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '10px',
          marginBottom: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              backgroundColor: '#eef2ff',
              color: '#170e5e',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <ShieldCheckIcon size={18} />
          </span>
          <div>
            <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#0f172a' }}>
              وضع الحماية المشدد (للمتاجر عالية الكثافة ومتعددة المخازن)
            </div>
            <div style={{ fontSize: '12px', color: '#64748b' }}>
              يفعّل كافة أقفال منع التلاعب بنقرة واحدة مع ضبط عتبات الإنذار الفوري على واتساب
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => applyPreset(STRICT_PRESET)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              borderRadius: '8px',
              border: '1px solid #170e5e',
              backgroundColor: '#170e5e',
              color: '#ffffff',
              fontSize: '12.5px',
              fontWeight: 600,
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          >
            <ShieldCheckIcon size={15} />
            تفعيل درع منع السرقة المشدد
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => applyPreset(STANDARD_PRESET)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              backgroundColor: '#ffffff',
              color: '#334155',
              fontSize: '12.5px',
              fontWeight: 600,
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          >
            <RefreshCwIcon size={14} />
            الوضع القياسي
          </button>
        </div>
      </div>

      <div className="document-prototype-grid compact-grid-2" style={{ gap: '12px', marginBottom: '16px' }}>
        <label style={checkboxCardStyle}>
          <input type="checkbox" {...form.register('antiTheftRequirePinForNoSale')} disabled={disabled} />
          <div>
            <div style={checkboxTitleStyle}>قفل فتح الدرج بدون بيع برمز مدير</div>
            <div style={checkboxDescStyle}>يمنع فتح الدرج النقدي بدون عملية بيع إلا بعد إدخال رمز أو كلمة مرور مدير</div>
          </div>
        </label>

        <label style={checkboxCardStyle}>
          <input type="checkbox" {...form.register('antiTheftEnforceMandatoryReceiptPrint')} disabled={disabled} />
          <div>
            <div style={checkboxTitleStyle}>إلزام الطباعة التلقائية للإيصال</div>
            <div style={checkboxDescStyle}>يمنع الكاشير من تعطيل طباعة الريسيت لإخفاء المبيعات أو عدم تسليم العميل إيصالاً</div>
          </div>
        </label>

        <label style={checkboxCardStyle}>
          <input type="checkbox" {...form.register('antiTheftRequireElectronicPaymentRef')} disabled={disabled} />
          <div>
            <div style={checkboxTitleStyle}>إلزام رقم مرجع التحويل الإلكتروني</div>
            <div style={checkboxDescStyle}>يُلزم بإدخال رقم مرجع لعمليات إنستاباي والمحافظ والكارت لمنع تحويل النقدي لوهمي</div>
          </div>
        </label>

        <label style={checkboxCardStyle}>
          <input type="checkbox" {...form.register('antiTheftLockWeightedManualEdit')} disabled={disabled} />
          <div>
            <div style={checkboxTitleStyle}>منع تعديل سعر/كمية باركود الميزان يدوياً</div>
            <div style={checkboxDescStyle}>يقفل التلاعب بملصقات الميزان الإلكتروني ويرصد تكرار مسح نفس الملصق بالوردية</div>
          </div>
        </label>

        <label style={checkboxCardStyle}>
          <input type="checkbox" {...form.register('antiTheftStrictTwoStepTransfers')} disabled={disabled} />
          <div>
            <div style={checkboxTitleStyle}>إلزام التحويل المخزني بمرحلتين (صرف ← استلام)</div>
            <div style={checkboxDescStyle}>يمنع النقل الفوري ويُبقي البضاعة بحساب «بضاعة بالطريق» بعهدة الناقل حتى الاستلام الفعلي</div>
          </div>
        </label>

        <label style={checkboxCardStyle}>
          <input type="checkbox" {...form.register('antiTheftRequireManagerForWriteOff')} disabled={disabled} />
          <div>
            <div style={checkboxTitleStyle}>اعتماد المدير الإلزامي للتالف والتسويات السالبة</div>
            <div style={checkboxDescStyle}>يتطلب كلمة مرور مدير محدد قبل إعدام أي بضاعة أو خصم مخزني يدوي</div>
          </div>
        </label>

        <label style={checkboxCardStyle}>
          <input type="checkbox" {...form.register('antiTheftEnforceBlindStockCount')} disabled={disabled} />
          <div>
            <div style={checkboxTitleStyle}>إلزام الجرد الأعمى للموظفين (Blind Count)</div>
            <div style={checkboxDescStyle}>يخفي الرصيد الدفتري عن الموظف أثناء الجرد فلا يستطيع تزوير العد ليتطابق مع الدفتر</div>
          </div>
        </label>

        <label style={checkboxCardStyle}>
          <input type="checkbox" {...form.register('antiTheftEnforceBlindPurchaseReceiving')} disabled={disabled} />
          <div>
            <div style={checkboxTitleStyle}>إلزام الاستلام الأعمى للمشتريات (Blind GRN)</div>
            <div style={checkboxDescStyle}>يخفي كميات أمر الشراء عن أمين المخزن عند استلام المورد وينبّه فوراً عند وجود فارق</div>
          </div>
        </label>

        <label style={checkboxCardStyle}>
          <input type="checkbox" {...form.register('antiTheftBlockOverdueDeliveryRep')} disabled={disabled} />
          <div>
            <div style={checkboxTitleStyle}>منع إسناد أوردرات لمندوب عليه عهدة متأخرة زمنياً</div>
            <div style={checkboxDescStyle}>يمنع خروج المندوب بأوردر جديد إذا كان لديه طلب غير مسوّى تجاوز المهلة الزمنية (افتراضياً 20 ساعة) دون تقييد حجم طلبات نفس اليوم</div>
          </div>
        </label>
      </div>

      <div className="document-prototype-grid compact-grid-2" style={{ gap: '12px' }}>
        <div className="field">
          <label>حد إنذار مسح السلة الفوري (قيمة السلة)</label>
          <input
            type="number"
            min={0}
            step="10"
            className="purchase-prototype-field-input"
            {...form.register('antiTheftCartClearAlertThreshold', { valueAsNumber: true })}
            disabled={disabled}
          />
          <div className="muted small" style={{ marginTop: 4 }}>
            إرسال تنبيه واتساب فوري للمالك عند مسح سلة تساوي أو تتجاوز هذا المبلغ (الافتراضي 200)
          </div>
        </div>

        <div className="field">
          <label>حد إنذار التالف والتسوية السالبة (تكلفة)</label>
          <input
            type="number"
            min={0}
            step="50"
            className="purchase-prototype-field-input"
            {...form.register('antiTheftWriteOffAlertThreshold', { valueAsNumber: true })}
            disabled={disabled}
          />
          <div className="muted small" style={{ marginTop: 4 }}>
            إرسال إنذار واتساب فوري عند تسجيل تالف أو خصم مخزني بهذه التكلفة أو أكثر (الافتراضي 500)
          </div>
        </div>

        <div className="field">
          <label>مهلة تنبيه البضاعة بالطريق (بالساعات)</label>
          <input
            type="number"
            min={1}
            max={168}
            className="purchase-prototype-field-input"
            {...form.register('antiTheftInTransitAlertHours', { valueAsNumber: true })}
            disabled={disabled}
          />
          <div className="muted small" style={{ marginTop: 4 }}>
            التنبيه تلقائياً إذا تأخر استلام إذن التحويل عن هذه المدة (الافتراضي 4 ساعات)
          </div>
        </div>

        <div className="field">
          <label>مهلة تسوية عهدة المندوب قبل المنع والتنبيه (بالساعات)</label>
          <input
            type="number"
            min={1}
            max={168}
            className="purchase-prototype-field-input"
            {...form.register('antiTheftDeliveryOverdueHours', { valueAsNumber: true })}
            disabled={disabled}
          />
          <div className="muted small" style={{ marginTop: 4 }}>
            يُمنع إسناد أوردرات جديدة للمندوب (عند تفعيل القفل) ويُدرج بالتنبيهات إذا مرّت هذه المدة دون تسوية (الافتراضي 20 ساعة)
          </div>
        </div>

        <div className="field">
          <label>سقف نقدي اختياري لعهدة المندوب (0 = مفتوح بلا حد)</label>
          <input
            type="number"
            min={0}
            step="100"
            className="purchase-prototype-field-input"
            {...form.register('antiTheftDefaultDeliveryCustodyCap', { valueAsNumber: true })}
            disabled={disabled}
          />
          <div className="muted small" style={{ marginTop: 4 }}>
            اتركه 0 لعدم تقييد مبيعات نفس اليوم، أو حدد سقفاً للمناديب الجدد فقط (ويمكن تخصيص سقف لكل مندوب على حدة)
          </div>
        </div>
      </div>
    </FormSection>
  );
}

const checkboxCardStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '10px',
  padding: '10px 12px',
  borderRadius: '10px',
  border: '1px solid #e2e8f0',
  backgroundColor: '#ffffff',
  cursor: 'pointer',
};

const checkboxTitleStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 700,
  color: '#0f172a',
  marginBottom: '2px',
};

const checkboxDescStyle: React.CSSProperties = {
  fontSize: '11.5px',
  color: '#64748b',
  lineHeight: 1.45,
};

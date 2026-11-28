import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsApi } from '@/shared/api/settings.api';
import { toast } from '@/shared/components/system-alert';
import { RefreshCwIcon, ShieldCheckIcon } from '@/shared/components/icons/AppIcons';
import type { AntiTheftSettingsSnapshot } from '../../api/cashier-fraud-radar.api';

interface Props {
  initialSettings: AntiTheftSettingsSnapshot;
  onSaved: () => void;
}

export function AntiTheftControlsTab({ initialSettings, onSaved }: Props) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<AntiTheftSettingsSnapshot>(initialSettings);

  useEffect(() => {
    setDraft(initialSettings);
  }, [initialSettings]);

  const saveMutation = useMutation({
    mutationFn: (next: AntiTheftSettingsSnapshot) =>
      settingsApi.update({
        antiTheftRequirePinForNoSale: next.requirePinForNoSale,
        antiTheftEnforceMandatoryReceiptPrint: next.enforceMandatoryReceiptPrint,
        antiTheftLockWeightedManualEdit: next.lockWeightedManualEdit,
        antiTheftRequireElectronicPaymentRef: next.requireElectronicPaymentRef,
        antiTheftStrictTwoStepTransfers: next.strictTwoStepTransfers,
        antiTheftRequireManagerForWriteOff: next.requireManagerForWriteOff,
        antiTheftEnforceBlindStockCount: next.enforceBlindStockCount,
        antiTheftEnforceBlindPurchaseReceiving: next.enforceBlindPurchaseReceiving,
        antiTheftBlockOverdueDeliveryRep: next.blockOverdueDeliveryRep,
        antiTheftCartClearAlertThreshold: Math.max(0, Number(next.cartClearAlertThreshold || 0)),
        antiTheftWriteOffAlertThreshold: Math.max(0, Number(next.writeOffAlertThreshold || 0)),
        antiTheftInTransitAlertHours: Math.max(1, Number(next.inTransitAlertHours || 4)),
        antiTheftDeliveryOverdueHours: Math.max(1, Number(next.deliveryOverdueHours || 20)),
        antiTheftDefaultDeliveryCustodyCap: Math.max(0, Number(next.defaultDeliveryCustodyCap || 0)),
      }),
    onSuccess: () => {
      toast.success('تم حفظ وتفعيل إعدادات درع منع الخسائر والسرقة بنجاح');
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      void queryClient.invalidateQueries({ queryKey: ['loss-prevention-command-center'] });
      onSaved();
    },
    onError: (err: any) => {
      toast.error(err?.message || 'تعذر حفظ إعدادات درع منع الخسائر');
    },
  });

  const applyStrictPreset = () => {
    const strict: AntiTheftSettingsSnapshot = {
      requirePinForNoSale: true,
      enforceMandatoryReceiptPrint: true,
      lockWeightedManualEdit: true,
      requireElectronicPaymentRef: true,
      strictTwoStepTransfers: true,
      requireManagerForWriteOff: true,
      enforceBlindStockCount: true,
      enforceBlindPurchaseReceiving: true,
      blockOverdueDeliveryRep: true,
      cartClearAlertThreshold: 200,
      writeOffAlertThreshold: 500,
      inTransitAlertHours: 4,
      deliveryOverdueHours: 20,
      defaultDeliveryCustodyCap: 0,
    };
    setDraft(strict);
    saveMutation.mutate(strict);
  };

  const applyStandardPreset = () => {
    const standard: AntiTheftSettingsSnapshot = {
      requirePinForNoSale: false,
      enforceMandatoryReceiptPrint: false,
      lockWeightedManualEdit: false,
      requireElectronicPaymentRef: false,
      strictTwoStepTransfers: false,
      requireManagerForWriteOff: false,
      enforceBlindStockCount: false,
      enforceBlindPurchaseReceiving: false,
      blockOverdueDeliveryRep: false,
      cartClearAlertThreshold: 200,
      writeOffAlertThreshold: 500,
      inTransitAlertHours: 4,
      deliveryOverdueHours: 20,
      defaultDeliveryCustodyCap: 0,
    };
    setDraft(standard);
    saveMutation.mutate(standard);
  };

  const toggles: Array<{
    key: keyof AntiTheftSettingsSnapshot;
    title: string;
    desc: string;
  }> = [
    {
      key: 'requirePinForNoSale',
      title: 'قفل فتح الدرج بدون بيع برمز مدير',
      desc: 'يمنع فتح الدرج النقدي بدون فاتورة إلا بموافقة مدير فورية',
    },
    {
      key: 'enforceMandatoryReceiptPrint',
      title: 'إلزام طباعة الريسيت تلقائياً',
      desc: 'يمنع الكاشير من إيقاف الطباعة التلقائية لإخفاء المبيعات عن العميل',
    },
    {
      key: 'requireElectronicPaymentRef',
      title: 'إلزام رقم مرجع للدفع الإلكتروني (إنستاباي / محفظة / كارت)',
      desc: 'يمنع تسجيل بيع كاش كتحويل إلكتروني وهمي بدون رقم مرجع حقيقي',
    },
    {
      key: 'lockWeightedManualEdit',
      title: 'منع التعديل اليدوي لباركود الميزان الإلكتروني',
      desc: 'يقفل تعديل السعر أو الوزن للباركود الموزون ويرصد تكرار نفس الملصق',
    },
    {
      key: 'strictTwoStepTransfers',
      title: 'إلزام التحويل المخزني بمرحلتين (صرف ← بضاعة بالطريق ← استلام)',
      desc: 'يغلق النقل الفوري ويُبقي البضاعة بعهدة الناقل حتى يؤكد الفرع الاستلام الفعلي',
    },
    {
      key: 'requireManagerForWriteOff',
      title: 'اعتماد كلمة مرور مدير للتالف والتسويات السالبة',
      desc: 'يمنع إعدام أي بضاعة أو خصم مخزني يدوي بدون كلمة مرور مدير محدد',
    },
    {
      key: 'enforceBlindStockCount',
      title: 'إلزام الجرد الأعمى للموظفين (Blind Count)',
      desc: 'يخفي الرصيد الدفتري من الخادم فلا يرى الموظف الكمية المفترضة أثناء العد',
    },
    {
      key: 'enforceBlindPurchaseReceiving',
      title: 'إلزام الاستلام الأعمى للمشتريات (Blind GRN)',
      desc: 'يخفي كميات أمر الشراء عن أمين المخزن وقت الاستلام وينبّه المالك عند أي فارق',
    },
    {
      key: 'blockOverdueDeliveryRep',
      title: 'منع إسناد أوردرات لمندوب عليه عهدة متأخرة زمنياً',
      desc: 'يسمح بأي حجم مبيعات في نفس اليوم، ويمنع خروج المندوب بأوردر جديد إذا كان عليه طلب غير مسوّى تجاوز المهلة',
    },
  ];

  return (
    <div style={cardStyle}>
      <div style={presetBannerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={iconBoxStyle}>
            <ShieldCheckIcon size={20} />
          </span>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
              درع منع الخسائر ومكافحة السرقة الداخلية — التفعيل الفوري
            </div>
            <div style={{ fontSize: '12px', color: '#64748b' }}>
              كل قفل اختياري ومضبوط لعدم تعطيل سير العمل الطبيعي؛ يمكنك التفعيل المشدد بنقرة واحدة أو تخصيص كل ضابط
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={saveMutation.isPending}
            onClick={applyStrictPreset}
            style={primaryBtnStyle}
          >
            <ShieldCheckIcon size={15} />
            تفعيل الحماية المشددة بنقرة واحدة
          </button>
          <button
            type="button"
            disabled={saveMutation.isPending}
            onClick={applyStandardPreset}
            style={secondaryBtnStyle}
          >
            <RefreshCwIcon size={14} />
            الوضع القياسي
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '10px', marginBottom: '16px' }}>
        {toggles.map((item) => {
          const checked = Boolean(draft[item.key]);
          return (
            <label
              key={item.key}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                padding: '11px 12px',
                borderRadius: '10px',
                border: checked ? '1px solid #c7d2fe' : '1px solid #e2e8f0',
                backgroundColor: checked ? '#f5f7ff' : '#ffffff',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setDraft((prev) => ({ ...prev, [item.key]: e.target.checked }))}
                style={{ marginTop: '3px' }}
              />
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>{item.title}</div>
                <div style={{ fontSize: '11.5px', color: '#64748b', lineHeight: 1.45, marginTop: '2px' }}>{item.desc}</div>
              </div>
            </label>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        <div style={fieldBoxStyle}>
          <label style={labelStyle}>مهلة تسوية عهدة المندوب (بالساعات)</label>
          <input
            type="number"
            min={1}
            max={168}
            value={draft.deliveryOverdueHours}
            onChange={(e) => setDraft((prev) => ({ ...prev, deliveryOverdueHours: Number(e.target.value) || 20 }))}
            style={inputStyle}
          />
          <div style={hintStyle}>الافتراضي 20 ساعة (منع خروج أوردرات جديدة عند التأخر)</div>
        </div>

        <div style={fieldBoxStyle}>
          <label style={labelStyle}>مهلة إنذار البضاعة بالطريق (بالساعات)</label>
          <input
            type="number"
            min={1}
            max={168}
            value={draft.inTransitAlertHours}
            onChange={(e) => setDraft((prev) => ({ ...prev, inTransitAlertHours: Number(e.target.value) || 4 }))}
            style={inputStyle}
          />
          <div style={hintStyle}>تنبيه واتساب فوري عند تأخر استلام التحويل</div>
        </div>

        <div style={fieldBoxStyle}>
          <label style={labelStyle}>حد إنذار مسح السلة الفوري</label>
          <input
            type="number"
            min={0}
            value={draft.cartClearAlertThreshold}
            onChange={(e) => setDraft((prev) => ({ ...prev, cartClearAlertThreshold: Math.max(0, Number(e.target.value) || 0) }))}
            style={inputStyle}
          />
          <div style={hintStyle}>إرسال إنذار واتساب بجميع أصناف السلة المحذوفة</div>
        </div>

        <div style={fieldBoxStyle}>
          <label style={labelStyle}>حد إنذار التالف والتسوية السالبة</label>
          <input
            type="number"
            min={0}
            value={draft.writeOffAlertThreshold}
            onChange={(e) => setDraft((prev) => ({ ...prev, writeOffAlertThreshold: Math.max(0, Number(e.target.value) || 0) }))}
            style={inputStyle}
          />
          <div style={hintStyle}>تكلفة التالف أو الخصم التي تطلق إنذار المالك</div>
        </div>

        <div style={fieldBoxStyle}>
          <label style={labelStyle}>سقف نقدي اختياري لعهدة المندوب (0 = مفتوح)</label>
          <input
            type="number"
            min={0}
            value={draft.defaultDeliveryCustodyCap}
            onChange={(e) => setDraft((prev) => ({ ...prev, defaultDeliveryCustodyCap: Math.max(0, Number(e.target.value) || 0) }))}
            style={inputStyle}
          />
          <div style={hintStyle}>اتركه 0 لعدم تقييد مبيعات نفس اليوم</div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          disabled={saveMutation.isPending}
          onClick={() => saveMutation.mutate(draft)}
          style={primaryBtnStyle}
        >
          {saveMutation.isPending ? 'جاري الحفظ...' : 'حفظ إعدادات درع منع الخسائر'}
        </button>
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '14px',
  padding: '16px',
};

const presetBannerStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  padding: '12px 14px',
  borderRadius: '12px',
  backgroundColor: '#f8fafc',
  border: '1px solid #e2e8f0',
  marginBottom: '16px',
};

const iconBoxStyle: React.CSSProperties = {
  width: '40px',
  height: '40px',
  borderRadius: '12px',
  backgroundColor: '#eef2ff',
  color: '#170e5e',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const primaryBtnStyle: React.CSSProperties = {
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
  cursor: 'pointer',
};

const secondaryBtnStyle: React.CSSProperties = {
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
  cursor: 'pointer',
};

const fieldBoxStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '5px',
};

const labelStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 700,
  color: '#334155',
};

const inputStyle: React.CSSProperties = {
  height: '36px',
  padding: '6px 10px',
  borderRadius: '8px',
  border: '1px solid #cbd5e1',
  fontSize: '13px',
  color: '#0f172a',
  backgroundColor: '#ffffff',
};

const hintStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#64748b',
};

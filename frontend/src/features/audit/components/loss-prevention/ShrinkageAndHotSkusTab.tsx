import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@/lib/format';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { toast } from '@/shared/components/system-alert';
import {
  CheckCircleIcon,
  PackageIcon,
  PlusIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from '@/shared/components/icons/AppIcons';
import {
  cashierFraudRadarApi,
  type CommandCenterResponse,
} from '../../api/cashier-fraud-radar.api';

interface Props {
  shrinkage: CommandCenterResponse['shrinkage'];
}

export function ShrinkageAndHotSkusTab({ shrinkage }: Props) {
  const queryClient = useQueryClient();

  const hotSkusQuery = useQuery({
    queryKey: ['loss-prevention-hot-skus'],
    queryFn: () => cashierFraudRadarApi.listHotSkus(),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ productId, isHighRisk }: { productId: number; isHighRisk: boolean }) =>
      cashierFraudRadarApi.toggleHotSku(productId, isHighRisk),
    onSuccess: (_data, vars) => {
      toast.success(vars.isHighRisk ? 'تمت إضافة الصنف إلى قائمة الرقابة اليومية المشددة' : 'تمت إزالة الصنف من قائمة الرقابة المشددة');
      void queryClient.invalidateQueries({ queryKey: ['loss-prevention-hot-skus'] });
      void queryClient.invalidateQueries({ queryKey: ['loss-prevention-command-center'] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'تعذر تحديث وسم الصنف');
    },
  });

  const hotSkus = hotSkusQuery.data?.hotSkus || [];
  const suggested = hotSkusQuery.data?.suggestedCandidates || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 1. Causes Breakdown Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '12px' }}>
        <div style={miniCardStyle}>
          <div style={miniLabelStyle}>خسائر التالف والهالك</div>
          <div style={miniValueStyle}>
            {formatCurrency(shrinkage.byCause.damaged.cost)} <CurrencySymbol />
          </div>
          <div style={miniSubStyle}>
            {shrinkage.byCause.damaged.count} محضر | كمية {shrinkage.byCause.damaged.qty}
          </div>
        </div>
        <div style={miniCardStyle}>
          <div style={miniLabelStyle}>خصم وتسويات مخزنية سالبة</div>
          <div style={miniValueStyle}>
            {formatCurrency(shrinkage.byCause.negative_adjustment.cost)} <CurrencySymbol />
          </div>
          <div style={miniSubStyle}>
            {shrinkage.byCause.negative_adjustment.count} حركة | كمية {shrinkage.byCause.negative_adjustment.qty}
          </div>
        </div>
        <div style={miniCardStyle}>
          <div style={miniLabelStyle}>عجز جلسات الجرد</div>
          <div style={miniValueStyle}>
            {formatCurrency(shrinkage.byCause.count_shortage.cost)} <CurrencySymbol />
          </div>
          <div style={miniSubStyle}>
            {shrinkage.byCause.count_shortage.count} بند | كمية {shrinkage.byCause.count_shortage.qty}
          </div>
        </div>
        <div style={miniCardStyle}>
          <div style={miniLabelStyle}>فاقد التحويلات المخزنية</div>
          <div style={miniValueStyle}>
            {formatCurrency(shrinkage.byCause.transfer_shortage.cost)} <CurrencySymbol />
          </div>
          <div style={miniSubStyle}>
            {shrinkage.byCause.transfer_shortage.count} واقعة | كمية {shrinkage.byCause.transfer_shortage.qty}
          </div>
        </div>
      </div>

      {/* 2. Top 10 Highest-Loss Products Heatmap */}
      <div style={cardStyle}>
        <div style={sectionHeaderStyle}>
          <span style={navyBarStyle} />
          <div>
            <h3 style={titleStyle}>خريطة أكثر الأصناف نزيفاً وعجزاً (Shrinkage Heatmap)</h3>
            <div style={subStyle}>
              الأصناف الأعلى تكلفة في الفاقد والتالف والعجز المخزني لتركيز الجرد المفاجئ والكاميرات عليها
            </div>
          </div>
        </div>

        {shrinkage.topProducts.length === 0 ? (
          <div style={emptyStyle}>
            <CheckCircleIcon size={26} color="#16a34a" />
            <div style={{ fontWeight: 700, color: '#0f172a', marginTop: '6px' }}>
              لا توجد خسائر أو عجز مخزني مسجل خلال هذه الفترة
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>الصنف</th>
                  <th style={thStyle}>المخزن الأكثر عجزاً</th>
                  <th style={thStyle}>الكمية المفقودة</th>
                  <th style={thStyle}>إجمالي التكلفة المفقودة</th>
                  <th style={thStyle}>عدد الوقائع</th>
                  <th style={thStyle}>تفصيل الأسباب</th>
                </tr>
              </thead>
              <tbody>
                {shrinkage.topProducts.map((p) => (
                  <tr key={p.productId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ ...tdStyle, fontWeight: 700, color: '#0f172a' }}>{p.productName}</td>
                    <td style={tdStyle}>{p.topLocationName}</td>
                    <td style={{ ...tdStyle, fontWeight: 700, color: '#b91c1c' }}>{p.totalQtyLost}</td>
                    <td style={{ ...tdStyle, fontWeight: 800, color: '#b91c1c' }}>
                      {formatCurrency(p.totalCostLost)} <CurrencySymbol />
                    </td>
                    <td style={tdStyle}>{p.incidentsCount}</td>
                    <td style={{ ...tdStyle, fontSize: '11.5px', color: '#475569' }}>
                      {[
                        p.causesBreakdown.damaged > 0 ? `تالف: ${formatCurrency(p.causesBreakdown.damaged)}` : '',
                        p.causesBreakdown.negative_adjustment > 0 ? `خصم يدوي: ${formatCurrency(p.causesBreakdown.negative_adjustment)}` : '',
                        p.causesBreakdown.count_shortage > 0 ? `عجز جرد: ${formatCurrency(p.causesBreakdown.count_shortage)}` : '',
                        p.causesBreakdown.transfer_shortage > 0 ? `فاقد تحويل: ${formatCurrency(p.causesBreakdown.transfer_shortage)}` : '',
                      ]
                        .filter(Boolean)
                        .join(' | ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 3. Hot SKUs Watchlist (High-Risk Shrinkage Products) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '16px' }}>
        <div style={cardStyle}>
          <div style={sectionHeaderStyle}>
            <span style={navyBarStyle} />
            <div>
              <h3 style={titleStyle}>الأصناف عالية الخطورة للفاقد (Hot SKUs — {hotSkus.length})</h3>
              <div style={subStyle}>
                أغلى وأخطر الأصناف القابلة للسرقة أو السحب (مثل المكسرات والبن والزيوت) للجرد السريع اليومي
              </div>
            </div>
          </div>

          {hotSkus.length === 0 ? (
            <div style={emptyStyle}>
              <PackageIcon size={24} color="#64748b" />
              <div style={{ fontSize: '12.5px', color: '#64748b', marginTop: '6px' }}>
                لم تقم بوسم أي أصناف ساخنة بعد — اختر من القائمة المقترحة بجانبك لإضافتها فوراً
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '300px', overflowY: 'auto' }}>
              {hotSkus.map((item) => (
                <div key={item.id} style={skuRowStyle}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>{item.name}</div>
                    <div style={{ fontSize: '11.5px', color: '#64748b' }}>
                      التكلفة: {formatCurrency(item.costPrice)} | الرصيد الكلي: {item.globalStockQty}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={toggleMutation.isPending}
                    onClick={() => toggleMutation.mutate({ productId: Number(item.id), isHighRisk: false })}
                    style={removeBtnStyle}
                    title="إزالة من قائمة الأصناف الساخنة"
                  >
                    <Trash2Icon size={14} /> إزالة
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={cardStyle}>
          <div style={sectionHeaderStyle}>
            <span style={navyBarStyle} />
            <div>
              <h3 style={titleStyle}>أصناف مقترحة للرقابة المشددة (الأعلى قيمة)</h3>
              <div style={subStyle}>
                أضف الصنف بنقرة واحدة ليظهر في زر «جرد سريع للأصناف الساخنة» داخل شاشة الجرد المخزني
              </div>
            </div>
          </div>

          {suggested.length === 0 ? (
            <div style={emptyStyle}>
              <ShieldCheckIcon size={24} color="#15803d" />
              <div style={{ fontSize: '12.5px', color: '#64748b', marginTop: '6px' }}>
                لا توجد أصناف إضافية مقترحة حالياً
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '300px', overflowY: 'auto' }}>
              {suggested.map((item) => (
                <div key={item.id} style={skuRowStyle}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>{item.name}</div>
                    <div style={{ fontSize: '11.5px', color: '#64748b' }}>
                      التكلفة: {formatCurrency(item.costPrice)} | الرصيد: {item.globalStockQty}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={toggleMutation.isPending}
                    onClick={() => toggleMutation.mutate({ productId: Number(item.id), isHighRisk: true })}
                    style={addBtnStyle}
                  >
                    <PlusIcon size={14} /> إضافة للرقابة
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
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

const miniCardStyle: React.CSSProperties = {
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '12px',
  padding: '14px',
};

const miniLabelStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: '#64748b',
};

const miniValueStyle: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 800,
  color: '#0f172a',
  marginTop: '4px',
};

const miniSubStyle: React.CSSProperties = {
  fontSize: '11.5px',
  color: '#64748b',
  marginTop: '2px',
};

const sectionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  marginBottom: '12px',
};

const navyBarStyle: React.CSSProperties = {
  width: '3px',
  height: '20px',
  borderRadius: '2px',
  backgroundColor: '#170e5e',
  display: 'inline-block',
  flexShrink: 0,
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '15px',
  fontWeight: 700,
  color: '#0f172a',
};

const subStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#64748b',
  marginTop: '2px',
};

const emptyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px 12px',
  textAlign: 'center',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '13px',
};

const thStyle: React.CSSProperties = {
  textAlign: 'right',
  padding: '9px 12px',
  backgroundColor: '#f8fafc',
  color: '#475569',
  fontSize: '12px',
  fontWeight: 600,
  borderBottom: '1px solid #e2e8f0',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  color: '#1e293b',
};

const skuRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '10px',
  padding: '8px 10px',
  borderRadius: '8px',
  border: '1px solid #e2e8f0',
  backgroundColor: '#f8fafc',
};

const addBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '5px 10px',
  borderRadius: '8px',
  border: '1px solid #170e5e',
  backgroundColor: '#170e5e',
  color: '#ffffff',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const removeBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '5px 10px',
  borderRadius: '8px',
  border: '1px solid #fecaca',
  backgroundColor: '#fef2f2',
  color: '#b91c1c',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

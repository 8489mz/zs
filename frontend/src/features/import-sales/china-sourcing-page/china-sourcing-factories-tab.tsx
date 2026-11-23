import { CheckCircleIcon, RefreshCwIcon, PlusCircleIcon, SearchIcon, AlertTriangleIcon } from '@/shared/components/icons/AppIcons';
import { LoadingState } from '@/shared/ui/loading-state';
import type { ChinaSupplier } from '../api/shipments.api';

export interface ChinaSourcingFactoriesTabProps {
  activeTab: 'factories' | 'quotations' | 'samples' | 'proformas' | 'qc' | 'trips';
  search: string;
  setSearch: React.Dispatch<React.SetStateAction<string>>;
  refetch: () => void;
  setIsNewSupplierModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isSuppliersLoading: boolean;
  filteredSuppliers: ChinaSupplier[];
  openMetaModal: (s: ChinaSupplier) => void;
}

export function ChinaSourcingFactoriesTab({ activeTab, search, setSearch, refetch, setIsNewSupplierModalOpen, isSuppliersLoading, filteredSuppliers, openMetaModal }: ChinaSourcingFactoriesTabProps) {
  return (
    <>
    {activeTab === 'factories' && (
      <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '18px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ position: 'relative', width: 280 }}>
              <input
                type="text"
                placeholder="بحث عن مصنع أو مدينة أو مقاطعة..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: '100%', height: 34, padding: '4px 32px 4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '12.5px' }}
              />
              <span style={{ position: 'absolute', right: 10, top: 9, color: '#94a3b8' }}>
                <SearchIcon size={14} />
              </span>
            </div>

            <button
              onClick={() => refetch()}
              style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '12px' }}
            >
              <RefreshCwIcon size={13} />
              تحديث
            </button>
          </div>

          <button
            onClick={() => setIsNewSupplierModalOpen(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 16px',
              borderRadius: 8,
              backgroundColor: '#170e5e',
              color: '#ffffff',
              border: 'none',
              fontSize: '12.5px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            <PlusCircleIcon size={15} />
            إضافة مصنع / مورد دولي جديد
          </button>
        </div>

        {isSuppliersLoading ? (
          <LoadingState title="جاري تحميل المصانع والموردين..." />
        ) : filteredSuppliers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 20px', border: '1px dashed #cbd5e1', borderRadius: 10, margin: '10px 0' }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>
              لا توجد مصانع أو موردين دوليين مسجلين
            </div>
            <p style={{ fontSize: '12.5px', color: '#64748b', maxWidth: 500, margin: '0 auto 16px', lineHeight: 1.6 }}>
              قم بتسجيل بيانات المصنع الصيني أو المورد الدولي، الاسم باللغة الصينية، والبيانات البنكية الرسمية لبدء طلب عروض الأسعار (RFQ) وإصدار الفواتير المبدئية (PI).
            </p>
            <button
              onClick={() => setIsNewSupplierModalOpen(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 18px',
                borderRadius: 8,
                backgroundColor: '#170e5e',
                color: '#ffffff',
                border: 'none',
                fontSize: '12.5px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <PlusCircleIcon size={15} />
              تسجيل أول مصنع صيني الآن
            </button>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>المصنع / المورد الدولي</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>الاسم الصيني والموقع</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>حد الطلب الأدنى MOQ</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>مدة الإنتاج والتجهيز</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>الحساب البنكي الموثق</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>الرصيد الدفتري (ج.م)</th>
                  <th style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filteredSuppliers.map((s) => {
                  const bank = typeof s.verified_bank_details === 'string' ? JSON.parse(s.verified_bank_details || '{}') : (s.verified_bank_details || {});
                  const isVerified = Boolean(bank.bankName && bank.swiftCode);
                  return (
                    <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '12px 14px', fontSize: '12.5px', fontWeight: 700, color: '#0f172a' }}>
                        {s.name}
                      </td>
                      <td style={{ padding: '12px 14px', fontSize: '12px', color: '#475569' }}>
                        {s.chinese_name ? `${s.chinese_name} (${s.city || ''})` : s.city || '—'}
                      </td>
                      <td style={{ padding: '12px 14px', fontSize: '12px', color: '#475569' }}>
                        {s.moq_description || 'غير محدد'}
                      </td>
                      <td style={{ padding: '12px 14px', fontSize: '12px', color: '#475569' }}>
                        {s.production_lead_time_days || 30} يوم
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '3px 8px',
                            borderRadius: 6,
                            backgroundColor: isVerified ? '#ecfdf5' : '#fffbeb',
                            color: isVerified ? '#047857' : '#b45309',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          {isVerified ? <CheckCircleIcon size={12} /> : <AlertTriangleIcon size={12} />}
                          {isVerified ? 'حساب موثق ومحمى' : 'يحتاج توثيق'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', fontSize: '12px', fontWeight: 700, color: Number(s.balance || 0) > 0 ? '#b91c1c' : '#059669' }}>
                        {Number(s.balance || 0).toLocaleString()} ج.م
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <button
                          onClick={() => openMetaModal(s)}
                          style={{
                            padding: '4px 10px',
                            backgroundColor: '#f1f5f9',
                            border: '1px solid #cbd5e1',
                            borderRadius: 6,
                            fontSize: '11.5px',
                            fontWeight: 700,
                            color: '#170e5e',
                            cursor: 'pointer',
                          }}
                        >
                          توثيق البيانات
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )}
    </>
  );
}

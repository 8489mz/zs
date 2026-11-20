import React from 'react';
import { PackageIcon } from '@/shared/components/icons/AppIcons';
import type { TFunction } from 'i18next';
import type { VanStockItem } from '../../api/van-sales.api';
import type { useStockAudit } from './use-stock-audit';

export interface StockAuditProps {
  audit: ReturnType<typeof useStockAudit>;
  inventory: VanStockItem[];
  t: TFunction;
}

export const StockAudit: React.FC<StockAuditProps> = ({ audit, inventory, t }) => {
  const {
    showStockAudit,
    setShowStockAudit,
    countedStockMap,
    stockAuditSearch,
    setStockAuditSearch,
    handleMatchAllStock,
    handleSetItemCount,
    filteredAuditInventory,
    stockAuditSummary,
  } = audit;
  return (
    <>
        {/* Interactive Physical Stock Audit Section */}
        {inventory && inventory.length > 0 && (
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '10px',
              border: '1px solid #e2e8f0',
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <PackageIcon size={16} color="#170e5e" />
                <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>
                  {t('delivery_reps.van_settle_tab.s37', "جرد وتدقيق بضاعة السيارة المتبقية (")}{inventory.length} {t('delivery_reps.van_settle_tab.s38', "صنف)")}
                </span>
                {stockAuditSummary.shortageCount > 0 && (
                  <span
                    style={{
                      backgroundColor: '#fee2e2',
                      color: '#b91c1c',
                      fontSize: '10.5px',
                      fontWeight: 800,
                      padding: '1px 6px',
                      borderRadius: '4px',
                      border: '1px solid #fca5a5',
                    }}
                  >
                    {t('delivery_reps.van_settle_tab.s39', "عجز")} {stockAuditSummary.shortageCount} {t('delivery_reps.van_settle_tab.s40', "صنف (-")}{stockAuditSummary.totalShortageCost.toFixed(2)} {t('delivery_reps.van_settle_tab.s41', "ج.م)")}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowStockAudit(!showStockAudit)}
                style={{
                  background: 'none',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  padding: '3px 8px',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: '#170e5e',
                  cursor: 'pointer',
                }}
              >
                {showStockAudit ? t('delivery_reps.van_settle_tab.s42', "إخفاء الجرد") : t('delivery_reps.van_settle_tab.s43', "بدء الجرد الفعلي")}
              </button>
            </div>

            {showStockAudit && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input
                    type="text"
                    value={stockAuditSearch}
                    onChange={(e) => setStockAuditSearch(e.target.value)}
                    placeholder={t('delivery_reps.van_settle_tab.s44', "بحث باسم الصنف أو الباركود...")}
                    style={{
                      flex: 1,
                      height: '32px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      padding: '0 8px',
                      fontSize: '11.5px',
                      boxSizing: 'border-box',
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleMatchAllStock}
                    style={{
                      height: '32px',
                      padding: '0 8px',
                      backgroundColor: '#f1f5f9',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      fontSize: '10.5px',
                      fontWeight: 700,
                      color: '#170e5e',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t('delivery_reps.van_settle_tab.s45', "مطابقة الكل دفترياً")}
                  </button>
                </div>

                {/* Items Grid */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '240px', overflowY: 'auto' }} className="thin-scrollbar">
                  {filteredAuditInventory.map((item) => {
                    const enteredStr = countedStockMap[item.productId];
                    const hasEntered = enteredStr !== undefined && enteredStr !== '';
                    const countedNum = hasEntered ? Number(enteredStr) : Number(item.qty);
                    const sysQty = Number(item.qty);
                    const isShort = hasEntered && countedNum < sysQty;
                    const isOver = hasEntered && countedNum > sysQty;
                    const isExact = hasEntered && countedNum === sysQty;

                    return (
                      <div
                        key={item.productId}
                        style={{
                          backgroundColor: isShort ? '#fff5f5' : isOver ? '#f0f9ff' : '#f8fafc',
                          border: `1px solid ${isShort ? '#fecaca' : isOver ? '#bae6fd' : '#e2e8f0'}`,
                          borderRadius: '8px',
                          padding: '6px 8px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px',
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: '11.5px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {item.productName}
                          </div>
                          <div style={{ fontSize: '10px', color: '#64748b', display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <span>{t('delivery_reps.van_settle_tab.s46', "دفتري بالسيارة:")} <b>{sysQty}</b></span>
                            {item.barcode && <span>• {item.barcode}</span>}
                          </div>
                        </div>

                        {/* Stepper with strict RTL Standard: [+] on right, [-] on left */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <button
                            type="button"
                            onClick={() => {
                              const cur = hasEntered ? Number(enteredStr) : sysQty;
                              handleSetItemCount(item.productId, String(cur + 1));
                            }}
                            style={{
                              width: '26px',
                              height: '26px',
                              borderRadius: '4px',
                              border: '1px solid #cbd5e1',
                              backgroundColor: '#ffffff',
                              fontWeight: 900,
                              fontSize: '13px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            +
                          </button>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={enteredStr !== undefined ? enteredStr : ''}
                            placeholder={String(sysQty)}
                            onChange={(e) => handleSetItemCount(item.productId, e.target.value)}
                            style={{
                              width: '46px',
                              height: '26px',
                              borderRadius: '4px',
                              border: `1px solid ${isShort ? '#ef4444' : '#cbd5e1'}`,
                              textAlign: 'center',
                              fontSize: '12px',
                              fontWeight: 800,
                              boxSizing: 'border-box',
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const cur = hasEntered ? Number(enteredStr) : sysQty;
                              handleSetItemCount(item.productId, String(Math.max(0, cur - 1)));
                            }}
                            style={{
                              width: '26px',
                              height: '26px',
                              borderRadius: '4px',
                              border: '1px solid #cbd5e1',
                              backgroundColor: '#ffffff',
                              fontWeight: 900,
                              fontSize: '13px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            -
                          </button>
                        </div>

                        {/* Status Badge */}
                        <div style={{ width: '60px', textAlign: 'center', flexShrink: 0 }}>
                          {isShort ? (
                            <span style={{ fontSize: '9.5px', fontWeight: 800, color: '#b91c1c', backgroundColor: '#fee2e2', padding: '1px 4px', borderRadius: '4px', display: 'block' }}>
                              {t('delivery_reps.van_settle_tab.s47', "عجز")} {sysQty - countedNum}
                            </span>
                          ) : isOver ? (
                            <span style={{ fontSize: '9.5px', fontWeight: 800, color: '#0369a1', backgroundColor: '#e0f2fe', padding: '1px 4px', borderRadius: '4px', display: 'block' }}>
                              +{countedNum - sysQty}
                            </span>
                          ) : isExact ? (
                            <span style={{ fontSize: '9.5px', fontWeight: 800, color: '#15803d', backgroundColor: '#dcfce7', padding: '1px 4px', borderRadius: '4px', display: 'block' }}>
                              {t('delivery_reps.van_settle_tab.s48', "مطابق")}
                            </span>
                          ) : (
                            <span style={{ fontSize: '9.5px', color: '#94a3b8' }}>{t('delivery_reps.van_settle_tab.s49', "دفتري")}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* INV-VAN-SELF-SETTLE-PIN-REQUIRED: the rep-side
                charge/waive checkbox is removed — the rep never decides
                whether his own stock shortage is charged to him or
                waived. A shortage now stays pending on the rep until a
                supervisor settles or waives it from the admin side. */}
              </div>
            )}
          </div>
        )}
    </>
  );
};

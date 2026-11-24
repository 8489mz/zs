export interface QuickCashAdvanceHeaderProps {
  activeTab: 'advance' | 'payout';
}

export function QuickCashAdvanceHeader({ activeTab }: QuickCashAdvanceHeaderProps) {
  return (
    <>
    {/* Header - Clean enterprise without redundant shortcut badge */}
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 4, height: 16, backgroundColor: '#170e5e', borderRadius: 2 }} />
        <h2 style={{ margin: 0, fontSize: '1.15rem', color: '#0f172a', fontWeight: 800 }}>
          {activeTab === 'payout' ? 'صرف الراتب وتصفية المستحقات' : 'صرف مسحوب من الراتب / سلفة كاشير'}
        </h2>
      </div>
      <p style={{ margin: '3px 0 0 12px', fontSize: '0.8rem', color: '#64748b' }}>
        {activeTab === 'payout'
          ? 'تسوية وصرف صافي أجر الموظف نقداً من عهدة الكاشير مع تصفير رصيد الفترة'
          : 'صرف نقدية سلفة من عهدة الكاشير تُخصم تلقائياً من الراتب القادم'}
      </p>
    </div>
    </>
  );
}

export interface ChinaSourcingTabsProps {
  tabItems: Array<{ key: 'factories' | 'quotations' | 'samples' | 'proformas' | 'qc' | 'trips'; label: string }>;
  activeTab: 'factories' | 'quotations' | 'samples' | 'proformas' | 'qc' | 'trips';
  setActiveTab: React.Dispatch<React.SetStateAction<'factories' | 'quotations' | 'samples' | 'proformas' | 'qc' | 'trips'>>;
}

export function ChinaSourcingTabs({ tabItems, activeTab, setActiveTab }: ChinaSourcingTabsProps) {
  return (
    <>
    {/* 2. Tabs */}
  <div className="horizontal-scroll-tabs" style={{ display: 'flex', gap: 8, borderBottom: '1px solid #e2e8f0', paddingBottom: 8, overflowX: 'auto' }}>
    {tabItems.map((tab) => {
      const isActive = activeTab === tab.key;
      return (
        <button
          key={tab.key}
          type="button"
          onClick={() => setActiveTab(tab.key)}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: isActive ? '1px solid #170e5e' : '1px solid #e2e8f0',
            boxSizing: 'border-box',
            fontSize: '12.5px',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            cursor: 'pointer',
            backgroundColor: isActive ? '#170e5e' : '#f8fafc',
            color: isActive ? '#ffffff' : '#475569',
          }}
        >
          {tab.label}
        </button>
      );
    })}
  </div>
    </>
  );
}

import type { Dispatch, SetStateAction } from 'react';

export interface QuickCashAdvanceTabsProps {
  setActiveTab: Dispatch<SetStateAction<'advance' | 'payout'>>;
  setAmount: Dispatch<SetStateAction<string>>;
  setNotes: Dispatch<SetStateAction<string>>;
  setFormError: Dispatch<SetStateAction<string>>;
  activeTab: 'advance' | 'payout';
  netAvailable: number;
  selectedEmployee: any;
}

export function QuickCashAdvanceTabs({ setActiveTab, setAmount, setNotes, setFormError, activeTab, netAvailable, selectedEmployee }: QuickCashAdvanceTabsProps) {
  return (
    <>
    {/* 1. Operational Tabs: Advance vs Wage Payout */}
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 6,
        backgroundColor: '#f1f5f9',
        padding: 4,
        borderRadius: 8,
        boxSizing: 'border-box',
      }}
    >
      <button
        type="button"
        onClick={() => {
          setActiveTab('advance');
          setAmount('');
          setNotes('');
          setFormError('');
        }}
        style={{
          padding: '7px 12px',
          borderRadius: 6,
          border: '1px solid',
          borderColor: activeTab === 'advance' ? '#170e5e' : 'transparent',
          backgroundColor: activeTab === 'advance' ? '#ffffff' : 'transparent',
          color: activeTab === 'advance' ? '#170e5e' : '#64748b',
          fontWeight: 600,
          fontSize: '0.84rem',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: activeTab === 'advance' ? '0 1px 3px rgba(0,0,0,0.05)' : 'none',
        }}
      >
        <span>سلفة / مسحوب على الحساب</span>
      </button>

      <button
        type="button"
        onClick={() => {
          setActiveTab('payout');
          setAmount(netAvailable > 0 ? String(netAvailable) : '');
          setNotes(`صرف وتصفية مستحقات أجر الفترة (${selectedEmployee?.displayName || 'الموظف'})`);
          setFormError('');
        }}
        style={{
          padding: '7px 12px',
          borderRadius: 6,
          border: '1px solid',
          borderColor: activeTab === 'payout' ? '#170e5e' : 'transparent',
          backgroundColor: activeTab === 'payout' ? '#ffffff' : 'transparent',
          color: activeTab === 'payout' ? '#170e5e' : '#64748b',
          fontWeight: 600,
          fontSize: '0.84rem',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: activeTab === 'payout' ? '0 1px 3px rgba(0,0,0,0.05)' : 'none',
        }}
      >
        <span>صرف الراتب وتصفية المستحقات</span>
      </button>
    </div>
    </>
  );
}

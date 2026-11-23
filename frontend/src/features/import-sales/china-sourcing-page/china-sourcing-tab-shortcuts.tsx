import { ChinaQuotationsTab } from '../components/ChinaQuotationsTab';
import { ChinaSamplesTab } from '../components/ChinaSamplesTab';
import { ChinaProformasTab } from '../components/ChinaProformasTab';

export interface ChinaSourcingTabShortcutsProps {
  activeTab: 'factories' | 'quotations' | 'samples' | 'proformas' | 'qc' | 'trips';
}

export function ChinaSourcingTabShortcuts({ activeTab }: ChinaSourcingTabShortcutsProps) {
  return (
    <>
    {/* 3. Tab Content */}
    {activeTab === 'quotations' && <ChinaQuotationsTab />}

    {activeTab === 'samples' && <ChinaSamplesTab />}

    {activeTab === 'proformas' && <ChinaProformasTab />}
    </>
  );
}

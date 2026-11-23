import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import { PlusCircleIcon } from '@/shared/components/icons/AppIcons';

export interface ChinaSourcingHeaderProps {
  setIsNewSupplierModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsQcModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export function ChinaSourcingHeader({ setIsNewSupplierModalOpen, setIsQcModalOpen }: ChinaSourcingHeaderProps) {
  return (
    <PageHeader
      title="سورسينج الصين وإدارة المصانع وفحص الجودة"
      description="توثيق حسابات البنوك لمنع الاحتيال، متابعة عروض الأسعار والعينات والفواتير المبدئية، وتقارير فحص الجودة قبل الشحن."
      actions={
        <div className="actions compact-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Button
            variant="primary"
            onClick={() => setIsNewSupplierModalOpen(true)}
            style={{
              height: '38px',
              padding: '0 18px',
              borderRadius: '8px',
              fontWeight: 700,
              background: '#170e5e',
              color: '#ffffff',
              border: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
            }}
          >
            <PlusCircleIcon size={15} />
            <span>إضافة مصنع / مورد دولي جديد</span>
          </Button>
          <Button
            variant="secondary"
            onClick={() => setIsQcModalOpen(true)}
            style={{
              height: '38px',
              padding: '0 16px',
              borderRadius: '8px',
              fontWeight: 700,
              background: '#ffffff',
              color: '#170e5e',
              border: '1px solid #cbd5e1',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
            }}
          >
            <PlusCircleIcon size={15} />
            <span>تقرير فحص جودة (QC)</span>
          </Button>
        </div>
      }
    />
  );
}

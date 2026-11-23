import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import { PlusCircleIcon, CheckCircleIcon } from '@/shared/components/icons/AppIcons';

export interface CustomsBrokerHeaderProps {
  setIsCreateBrokerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsDisburseOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsLiquidateOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export function CustomsBrokerHeader({ setIsCreateBrokerOpen, setIsDisburseOpen, setIsLiquidateOpen }: CustomsBrokerHeaderProps) {
  return (
    <PageHeader
      title="المخلصون الجمركيون وإدارة العهد"
      description="متابعة عهد التخليص الجمركي وتصفية المصروفات بإيصالات رسمية وضبط رصيد المخلصين بالموانئ."
      actions={
        <div className="actions compact-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Button
            variant="primary"
            onClick={() => setIsCreateBrokerOpen(true)}
            style={{
              height: '38px',
              padding: '0 16px',
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
            <span>إضافة مخلص جمركي</span>
          </Button>
          <Button
            variant="secondary"
            onClick={() => setIsDisburseOpen(true)}
            style={{
              height: '38px',
              padding: '0 14px',
              borderRadius: '8px',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              borderColor: '#0284c7',
              color: '#0284c7',
            }}
          >
            <PlusCircleIcon size={14} />
            <span>صرف عهدة تسيير جمركي</span>
          </Button>
          <Button
            variant="secondary"
            onClick={() => setIsLiquidateOpen(true)}
            style={{
              height: '38px',
              padding: '0 14px',
              borderRadius: '8px',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              borderColor: '#15803d',
              color: '#15803d',
            }}
          >
            <CheckCircleIcon size={14} />
            <span>تصفية مصاريف بإيصالات</span>
          </Button>
        </div>
      }
    />
  );
}

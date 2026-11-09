import { Link } from 'react-router-dom';
import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import { useTranslation } from "react-i18next";

type Props = {
  totalItems: number;
  description: string;
  onCopySummary: () => void | Promise<void>;
  // I5-D1: the sales register's only sale-creation entry was an unconditional
  // link to /pos — in a POS-off tenant it dead-ended on the disabled page.
  // The workspace hides it via the shared POS-availability rule (same rule
  // the sidebar already uses to hide the POS nav item); the working
  // enterprise sale path (sales orders) stays reachable from the sidebar.
  showPosButton: boolean;
};

export function SalesWorkspaceHeader({ totalItems, description, onCopySummary, showPosButton }: Props) {
    const { t } = useTranslation();
  return (
    <PageHeader
      title={t('sales.ad7466')}
      description={description}
      actions={(
        <div className="actions compact-actions">
          <Button variant="secondary" onClick={() => void onCopySummary()} disabled={!totalItems}>{t('sales.dd3bfd')}</Button>
          <Link to="/quotations"><Button variant="secondary">{t('sidebar.quotations', 'عروض الأسعار')}</Button></Link>
          <Link to="/returns"><Button variant="secondary">{t('sidebar.returns', 'مرتجعات المبيعات')}</Button></Link>
          {showPosButton && (<Link to="/pos"><Button>{t('sales.8f29d0', 'فتح الكاشير')}</Button></Link>)}
        </div>
      )}
    />
  );
}

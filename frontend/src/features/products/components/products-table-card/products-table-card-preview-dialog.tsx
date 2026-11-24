import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import type { useTranslation } from 'react-i18next';

export interface ProductsTableCardPreviewDialogProps {
  previewImage: { url: string; title: string } | null;
  setPreviewImage: (val: { url: string; title: string } | null) => void;
  __t: ReturnType<typeof useTranslation>['t'];
}

export function ProductsTableCardPreviewDialog({ previewImage, setPreviewImage, __t }: ProductsTableCardPreviewDialogProps) {
  return (
    <>
    {previewImage ? (
      <StandardDialog
        open={Boolean(previewImage)}
        onClose={() => setPreviewImage(null)}
        title={previewImage.title}
        subtitle={__t('products.products_table_card.preview_image', "معاينة صورة الصنف")}
        size="sm"
        compact
        footerActions={
          <StandardDialogFooter
            cancelLabel={__t('products.products_table_card.s73', "إغلاق")}
            onCancel={() => setPreviewImage(null)}
          />
        }
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', background: '#f8fafc', borderRadius: '10px', minHeight: '220px' }}>
          <img
            src={previewImage.url}
            alt={previewImage.title}
            style={{
              maxWidth: '100%',
              maxHeight: '400px',
              objectFit: 'contain',
              borderRadius: '8px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            }}
          />
        </div>
      </StandardDialog>
    ) : null}
    </>
  );
}

import { ProductCardModal } from '@/shared/components/ProductCardModal';
import { getProductLocationDisplayName } from '../../utils/product-location.utils';
import type { Product } from '@/types/domain';

export interface ProductsTableCardCardModalProps {
  activeCardProduct: Product | null;
  setActiveCardProduct: (val: Product | null) => void;
  categoryNames: Record<string, string>;
  supplierNames: Record<string, string>;
  locationNames: Record<string, string>;
  onSelectProduct: (product: Product | null) => void;
  onOpenBarcodeDialog: (product: Product, mode?: 'scan' | 'generate') => void;
  onOpenOfferDialog: (product: Product) => void;
  onOpenSerialsDialog?: (product: Product) => void;
  onToggleArchiveProduct?: (product: Product) => void;
  onDeleteProduct: (product: Product) => void;
  mobileStoreEnabled?: boolean;
}

export function ProductsTableCardCardModal({ activeCardProduct, setActiveCardProduct, categoryNames, supplierNames, locationNames, onSelectProduct, onOpenBarcodeDialog, onOpenOfferDialog, onOpenSerialsDialog, onToggleArchiveProduct, onDeleteProduct, mobileStoreEnabled }: ProductsTableCardCardModalProps) {
  return (
    <>
    {activeCardProduct ? (
      <ProductCardModal
        product={activeCardProduct}
        onClose={() => setActiveCardProduct(null)}
        categoryName={activeCardProduct.categoryId ? categoryNames[String(activeCardProduct.categoryId)] : undefined}
        supplierName={activeCardProduct.supplierId ? supplierNames[String(activeCardProduct.supplierId)] : undefined}
        locationName={locationNames ? getProductLocationDisplayName(activeCardProduct, locationNames) : undefined}
        onEditProduct={(p) => onSelectProduct(p)}
        onOpenBarcodeDialog={(p, mode) => onOpenBarcodeDialog(p, mode)}
        onOpenOfferDialog={(p) => onOpenOfferDialog(p)}
        onOpenSerialsDialog={onOpenSerialsDialog}
        onToggleArchiveProduct={onToggleArchiveProduct}
        onDeleteProduct={onDeleteProduct}
        mobileStoreEnabled={mobileStoreEnabled}
      />
    ) : null}
    </>
  );
}

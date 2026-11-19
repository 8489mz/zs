import { Suspense, lazy } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { PosNewProductModal } from '@/features/pos/components/pos-workspace/PosNewProductModal';
import { PosScannedInvoiceModal } from '@/features/pos/components/pos-workspace/PosScannedInvoiceModal';
import { PosPhoneOrderDialog } from '@/features/pos/components/pos-workspace/PosPhoneOrderDialog';
import { PosCallerIdFloatingAlert } from '@/features/pos/components/pos-workspace/PosCallerIdFloatingAlert';
import type { usePosWorkspace } from '@/features/pos/hooks/usePosWorkspace';
import type { Product, Sale } from '@/types/domain';
import { toast } from '@/shared/components/system-alert';

// New-product, edit-product, scanned-invoice and phone-order dialog
// mounts of the POS workspace. Pure move from PosWorkspace; the
// workspace keeps all state and handlers.

const LazyPosEditProductModal = lazy(() => import('@/features/pos/components/pos-workspace/PosEditProductModal').then((m) => ({ default: m.PosEditProductModal })));

export interface PosWorkspaceAuxDialogs2Props {
  newProductModalOpen: boolean;
  setNewProductModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  focusBarcodeEntry: () => void;
  newProductInitialName: string;
  newProductInitialBarcode: string;
  pos: ReturnType<typeof usePosWorkspace>;
  editProductId: string | null;
  editProduct: Product | null;
  setEditProductId: React.Dispatch<React.SetStateAction<string | null>>;
  handleProductUpdatedFromModal: (updatedProduct: Product) => void;
  scannedSale: Sale | null;
  scannedSaleModalOpen: boolean;
  setScannedSaleModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setScannedSale: React.Dispatch<React.SetStateAction<Sale | null>>;
  navigate: NavigateFunction;
  isPhoneOrdersActive: boolean;
  handleOpenPhoneOrder: (phone?: string, name?: string) => void;
  phoneOrderOpen: boolean;
  setPhoneOrderOpen: React.Dispatch<React.SetStateAction<boolean>>;
  phoneOrderInitialPhone: string;
  phoneOrderInitialName: string;
}

export function PosWorkspaceAuxDialogs2({
  newProductModalOpen,
  setNewProductModalOpen,
  focusBarcodeEntry,
  newProductInitialName,
  newProductInitialBarcode,
  pos,
  editProductId,
  editProduct,
  setEditProductId,
  handleProductUpdatedFromModal,
  scannedSale,
  scannedSaleModalOpen,
  setScannedSaleModalOpen,
  setScannedSale,
  navigate,
  isPhoneOrdersActive,
  handleOpenPhoneOrder,
  phoneOrderOpen,
  setPhoneOrderOpen,
  phoneOrderInitialPhone,
  phoneOrderInitialName,
}: PosWorkspaceAuxDialogs2Props) {
  return (
    <>
      {newProductModalOpen && (
        <PosNewProductModal
          isOpen={newProductModalOpen}
          onClose={() => {
            setNewProductModalOpen(false);
            focusBarcodeEntry();
          }}
          initialName={newProductInitialName}
          initialBarcode={newProductInitialBarcode}
          onSuccess={(newProduct) => {
            setNewProductModalOpen(false);
            if (newProduct.itemKind === 'fashion' && newProduct.styleCode) {
              // A grouped creation returns its first variant, not the customer's size.
              const suffix = [newProduct.color, newProduct.size].filter(Boolean).join(' / ');
              const baseName = suffix && newProduct.name.endsWith(` - ${suffix}`)
                ? newProduct.name.slice(0, -(` - ${suffix}`).length) : newProduct.name;
              pos.setSearch(baseName);
              toast.warning('الموديل اتضاف. اختار اللون والمقاس المطلوب من النتائج قبل إضافته للسلة.');
            } else {
              pos.handleAddProduct(newProduct);
              pos.setSearch('');
            }
            focusBarcodeEntry();
          }}
        />
      )}

      {editProductId && (
        <Suspense fallback={null}>
          <LazyPosEditProductModal
            isOpen={Boolean(editProductId)}
            productId={editProductId}
            initialProduct={editProduct}
            onClose={() => {
              setEditProductId(null);
              focusBarcodeEntry();
            }}
            onSuccess={handleProductUpdatedFromModal}
          />
        </Suspense>
      )}

      <PosScannedInvoiceModal
        sale={scannedSale}
        isOpen={scannedSaleModalOpen}
        onClose={() => {
          setScannedSaleModalOpen(false);
          setScannedSale(null);
          focusBarcodeEntry();
        }}
        settings={pos.settingsQuery.data}
        onOpenReturns={(targetSale) => {
          setScannedSaleModalOpen(false);
          setScannedSale(null);
          navigate(`/returns?invoiceId=${targetSale.id}&docNo=${encodeURIComponent(targetSale.docNo || '')}`);
        }}
      />

      {isPhoneOrdersActive && (
        <>
          <PosCallerIdFloatingAlert onOpenPhoneOrder={handleOpenPhoneOrder} />
          <PosPhoneOrderDialog
            open={phoneOrderOpen}
            onClose={() => {
              setPhoneOrderOpen(false);
              focusBarcodeEntry();
            }}
            pos={pos}
            initialPhone={phoneOrderInitialPhone}
            initialName={phoneOrderInitialName}
          />
        </>
      )}
    </>
  );
}

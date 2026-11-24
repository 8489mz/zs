import { ProductIconStudioModal } from '@/shared/components/icons/ProductIconStudioModal';

export interface ProductsTableCardIconStudioModalProps {
  isStudioOpen: boolean;
  setIsStudioOpen: (val: boolean) => void;
  handleAutoAssignIcons: () => Promise<void>;
  handleClearAllIcons: () => Promise<void>;
  isAutoAssigning: boolean;
}

export function ProductsTableCardIconStudioModal({ isStudioOpen, setIsStudioOpen, handleAutoAssignIcons, handleClearAllIcons, isAutoAssigning }: ProductsTableCardIconStudioModalProps) {
  return (
    <ProductIconStudioModal
      open={isStudioOpen}
      onClose={() => setIsStudioOpen(false)}
      onBulkAutoAssign={() => void handleAutoAssignIcons()}
      onBulkClearIcons={() => void handleClearAllIcons()}
      isBulkLoading={isAutoAssigning}
    />
  );
}

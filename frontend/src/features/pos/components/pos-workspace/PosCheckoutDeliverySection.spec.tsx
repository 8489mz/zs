/* T11-D (INV-REST-COD-COLLECTION-TRUTH): the checkout shows the
 * effective collection status before confirm — the cashier sees who
 * holds the cash (courier / rep / gateway) instead of discovering
 * it on the posted invoice. An unstated status reads as COD: the
 * courier collects, nothing is prepaid. These cases drive the real
 * PosCheckoutDeliverySection with a stubbed workspace state. */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PosCheckoutDeliverySection } from './PosCheckoutDialogSections';
import type { PosWorkspaceState } from '@/features/pos/components/pos-workspace/posWorkspace.helpers';
import type { DeliveryRep } from '@/shared/api/delivery-reps.api';

const REPS: DeliveryRep[] = [
  { id: 1, name: 'Rep One', phone: '01000000001', is_active: true },
];

function makePos(overrides: Record<string, unknown> = {}): PosWorkspaceState {
  return {
    orderType: 'delivery',
    collectionStatus: 'cod',
    setCollectionStatus: vi.fn(),
    deliveryRepId: '1',
    setDeliveryRepId: vi.fn(),
    setDeliveryFeeMode: vi.fn(),
    deliveryFee: 30,
    setDeliveryFee: vi.fn(),
    note: '',
    setNote: vi.fn(),
    setPaymentChannel: vi.fn(),
    setCashAmount: vi.fn(),
    setCardAmount: vi.fn(),
    setTransferAmount: vi.fn(),
    totals: { total: 530 },
    settings: undefined,
    settingsQuery: undefined,
    terminalPaymentDetails: undefined,
    ...overrides,
  } as unknown as PosWorkspaceState;
}

describe('PosCheckoutDeliverySection — effective collection status before confirm (T11-D)', () => {
  it('shows COD with the courier collecting when the status is cod', () => {
    render(<PosCheckoutDeliverySection pos={makePos()} deliveryReps={REPS} />);

    const summary = screen.getByTestId('pos-collection-status-summary');
    expect(summary).toHaveTextContent('التحصيل: تحصيل من العميل');
    expect(summary).toHaveTextContent('Rep One');
    expect(summary).toHaveTextContent('لم يُسجَّل أي نقد بعد');
  });

  it('shows COD when the status is unstated', () => {
    render(
      <PosCheckoutDeliverySection
        pos={makePos({ collectionStatus: undefined })}
        deliveryReps={REPS}
      />,
    );

    const summary = screen.getByTestId('pos-collection-status-summary');
    expect(summary).toHaveTextContent('التحصيل: تحصيل من العميل');
    expect(summary).toHaveTextContent('لم يُسجَّل أي نقد بعد');
  });

  it('shows prepaid from the rep when the status is prepaid_by_rep', () => {
    render(
      <PosCheckoutDeliverySection
        pos={makePos({ collectionStatus: 'prepaid_by_rep' })}
        deliveryReps={REPS}
      />,
    );

    const summary = screen.getByTestId('pos-collection-status-summary');
    expect(summary).toHaveTextContent('التحصيل: خالص من المندوب');
    expect(summary).toHaveTextContent('المبلغ مع المندوب');
    expect(summary).not.toHaveTextContent('لم يُسجَّل أي نقد بعد');
  });

  it('shows prepaid online when the status is prepaid_online', () => {
    render(
      <PosCheckoutDeliverySection
        pos={makePos({ collectionStatus: 'prepaid_online' })}
        deliveryReps={REPS}
      />,
    );

    const summary = screen.getByTestId('pos-collection-status-summary');
    expect(summary).toHaveTextContent('التحصيل: خالص أونلاين');
    expect(summary).toHaveTextContent('مدفوع مسبقاً');
    expect(summary).not.toHaveTextContent('لم يُسجَّل أي نقد بعد');
  });

  it('renders nothing for a non-delivery order', () => {
    const { container } = render(
      <PosCheckoutDeliverySection
        pos={makePos({ orderType: 'takeaway' })}
        deliveryReps={REPS}
      />,
    );

    expect(screen.queryByTestId('pos-collection-status-summary')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });
});

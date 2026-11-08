/* MaintenanceReceiptModal passcode removal (batch M3, package 11): the
 * printed receipt, the device sticker, the exported PDF and the WhatsApp
 * share text must NEVER contain the ticket's device passcode. The customer
 * knows their own code; the shop keeps it masked on demand in the detail
 * modal (batch M2, package 7). The passcode is removed entirely from every
 * receipt surface — no masked placeholder row, no "hidden" label — so the
 * spec asserts the distinctive fixture value (and its profile label) are
 * absent from each surface, while the serial number, ticket number and
 * amounts still render (positive controls that the surface rendered). */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MaintenanceReceiptModal } from '@/features/maintenance/components/MaintenanceReceiptModal';
import {
  exportMaintenanceReceiptPdf,
  printMaintenanceDeviceSticker,
  printMaintenanceReceipt,
} from '@/features/maintenance/utils/maintenance-receipt.utils';
import { getMaintenanceProfile } from '@/features/maintenance/constants/maintenance-profiles';
import type { MaintenanceTicket } from '@/types/domain-models/maintenance';

const { printHtmlDocumentMock, html2canvasMock } = vi.hoisted(() => ({
  printHtmlDocumentMock: vi.fn(),
  html2canvasMock: vi.fn(),
}));

vi.mock('@/lib/browser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/browser')>();
  return { ...actual, printHtmlDocument: printHtmlDocumentMock };
});

vi.mock('html2canvas', () => ({ default: html2canvasMock }));

vi.mock('jspdf', () => ({
  jsPDF: vi.fn().mockImplementation(() => ({ addImage: vi.fn(), save: vi.fn() })),
}));

/* Distinctive fake code: it shares no substring with the ticket number,
 * serial, phone or any amount, so any occurrence is an unmistakable leak. */
const PASSCODE = 'K7Q9-4X2Z8';

const TICKET: MaintenanceTicket = {
  id: 't1',
  ticketNo: 'ZM-261108-0001',
  customerId: null,
  customerName: 'أحمد',
  customerPhone: '01000000000',
  deviceBrand: 'Samsung',
  deviceModel: 'Galaxy A54',
  serialNumber: 'SN-987654321',
  passcode: PASSCODE,
  problemDescription: 'شاشة مكسورة',
  deviceCondition: null,
  expectedCost: 1000,
  finalCost: 800,
  advancePayment: 300,
  status: 'repaired',
  technicianId: null,
  technicianName: null,
  technicianNotes: null,
  branchId: null,
  locationId: null,
  saleId: null,
  warrantyDays: 30,
  receivedAt: '2026-11-08T10:00:00.000Z',
  repairedAt: null,
  deliveredAt: null,
  createdAt: '2026-11-08T10:00:00.000Z',
  parts: [],
};

const PASSCODE_LABEL = getMaintenanceProfile().passcodeLabel;

let capturedPdfHtml = '';

function renderReceiptModal(ticket: MaintenanceTicket = TICKET) {
  const user = userEvent.setup();
  const view = render(
    <MaintenanceReceiptModal open ticket={ticket} settings={null} onClose={vi.fn()} />,
  );
  return { ...view, user };
}

describe('MaintenanceReceiptModal receipt surfaces contain no passcode', () => {
  beforeEach(() => {
    printHtmlDocumentMock.mockReset();
    html2canvasMock.mockReset();
    capturedPdfHtml = '';
    /* The PDF builder renders its HTML into a hidden node in the document
     * and hands that node to html2canvas; capture the live DOM at that
     * moment — exportMaintenanceReceiptPdf removes the node afterwards. */
    html2canvasMock.mockImplementation(async () => {
      capturedPdfHtml = document.body.innerHTML;
      return { height: 200, width: 460, toDataURL: () => 'data:image/png;base64,FAKE' };
    });
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  it('receipt preview shows serial and amounts but never the passcode', () => {
    renderReceiptModal();
    expect(screen.getByText('ZM-261108-0001')).toBeInTheDocument();
    expect(document.body.textContent).toContain('SN-987654321');
    expect(document.body.textContent).toContain('800.00');
    expect(document.body.textContent).not.toContain(PASSCODE);
    expect(document.body.textContent).not.toContain(PASSCODE_LABEL);
  });

  it('sticker preview shows device and problem but never the passcode', async () => {
    const { user } = renderReceiptModal();
    await user.click(screen.getByRole('button', { name: /ستيكر ظهر الجهاز/ }));
    expect(screen.getByText('ZM-261108-0001')).toBeInTheDocument();
    expect(document.body.textContent).toContain('Galaxy A54');
    expect(document.body.textContent).toContain('شاشة مكسورة');
    expect(document.body.textContent).not.toContain(PASSCODE);
    expect(document.body.textContent).not.toContain(PASSCODE_LABEL);
  });

  it('printed receipt HTML contains no passcode', () => {
    printMaintenanceReceipt(TICKET);
    expect(printHtmlDocumentMock).toHaveBeenCalledTimes(1);
    const html = String(printHtmlDocumentMock.mock.calls[0][1]);
    expect(html).toContain('ZM-261108-0001');
    expect(html).toContain('SN-987654321');
    expect(html).toContain('800.00');
    expect(html).not.toContain(PASSCODE);
    expect(html).not.toContain(PASSCODE_LABEL);
  });

  it('printed sticker HTML contains no passcode', () => {
    printMaintenanceDeviceSticker(TICKET);
    expect(printHtmlDocumentMock).toHaveBeenCalledTimes(1);
    const html = String(printHtmlDocumentMock.mock.calls[0][1]);
    expect(html).toContain('ZM-261108-0001');
    expect(html).toContain('Galaxy A54');
    expect(html).toContain('شاشة مكسورة');
    expect(html).not.toContain(PASSCODE);
    expect(html).not.toContain('الرمز:');
  });

  it('exported PDF HTML contains no passcode', async () => {
    await exportMaintenanceReceiptPdf(TICKET);
    expect(html2canvasMock).toHaveBeenCalledTimes(1);
    expect(capturedPdfHtml).toContain('ZM-261108-0001');
    expect(capturedPdfHtml).toContain('SN-987654321');
    expect(capturedPdfHtml).toContain('800.00');
    expect(capturedPdfHtml).not.toContain(PASSCODE);
    expect(capturedPdfHtml).not.toContain(PASSCODE_LABEL);
  });

  it('WhatsApp share text contains no passcode', async () => {
    const { user } = renderReceiptModal();
    await user.click(screen.getByRole('button', { name: /واتساب/ }));
    await waitFor(() => expect(window.open).toHaveBeenCalledTimes(1));
    const url = new URL(String((window.open as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]));
    const text = url.searchParams.get('text') ?? '';
    expect(text).toContain('ZM-261108-0001');
    expect(text).toContain('Galaxy A54');
    expect(text).not.toContain(PASSCODE);
  });
});

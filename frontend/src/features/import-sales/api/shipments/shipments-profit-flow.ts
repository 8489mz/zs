import { useQuery } from '@tanstack/react-query';
import { http } from '@/lib/http';

export interface ProfitReport {
  totalRevenue: number;
  totalCost: number;
  grossProfit: number;
  totalExpenses: number;
  netProfitPool: number;
  profitAttributionVerified?: boolean;
  attributionStatus?: string;
  partnerShares: {
    partnerId: string;
    name: string;
    percentage: number;
    shareAmount: number;
    withdrawnProfit?: number;
    currentBalance?: number;
  }[];
}

export const useProfitReportQuery = (startDate: string, endDate: string, projectId?: string) => {
  return useQuery({
    queryKey: ['profit-report', startDate, endDate, projectId || ''],
    queryFn: async () => {
      const projectParam = projectId ? `&projectId=${encodeURIComponent(projectId)}` : '';
      const data = await http<{ success: boolean, message: string, data: ProfitReport }>(
        `/api/import-sales/profit-report?startDate=${startDate}&endDate=${endDate}${projectParam}`
      );
      return data.data;
    },
    enabled: !!startDate && !!endDate,
  });
};

// INV-IMPORT-TRACEABILITY-APPROVALS-POOL: one traceability source of
// truth. The approvals queue, the reconciliation tie-out and the
// profit-pool attribution below all read these same events — derived
// from the tables that store each event — instead of separate
// counters that stayed 0 while the flow was fully posted.
export interface ImportFlowEvent {
  kind: 'project' | 'proforma_invoice' | 'shipment' | 'receipt' | 'supplier_payment' | 'partner_payout' | 'approval_request' | string;
  ref: string;
  label: string;
  state: string;
  projectId: string | null;
  shipmentId: string | null;
  amountEgp: number | null;
  amountForeign: number | null;
  currency: string | null;
  journalEntryNo: string | null;
  journalMatched: boolean | null;
  createdAt: string | null;
}

export interface ImportFlowTrace {
  events: ImportFlowEvent[];
  counts: {
    projects: number;
    proformaInvoices: number;
    proformaInvoicesApproved: number;
    shipments: number;
    shipmentsArrived: number;
    receipts: number;
    receiptsPosted: number;
    receiptsMatched: number;
    supplierPayments: number;
    partnerPayouts: number;
    approvalsPending: number;
    approvalsApproved: number;
    approvalsRejected: number;
    approvalsExecuted: number;
  };
}

export const useImportFlowEventsQuery = (projectId?: string) => {
  return useQuery({
    queryKey: ['import-traceability', projectId || ''],
    queryFn: async () => {
      const projectParam = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
      return await http<ImportFlowTrace>(`/api/import-sales/traceability${projectParam}`);
    },
  });
};

export interface ProjectProfitShipmentRow {
  shipmentId: string;
  containerNumber: string;
  status: string;
  receivedQuantity: number;
  landedCostEgp: number;
  salesRevenueEgp: number;
  salesCostEgp: number;
}

export interface ProjectProfitRow extends ProfitReport {
  projectId: string;
  projectNo: string;
  title: string;
  status: string;
  shipments: ProjectProfitShipmentRow[];
}

export interface ProjectProfitAttribution {
  startDate: string;
  endDate: string;
  projects: ProjectProfitRow[];
  total: ProfitReport;
}

export const useProjectProfitAttributionQuery = (startDate: string, endDate: string) => {
  return useQuery({
    queryKey: ['profit-attribution', startDate, endDate],
    queryFn: async () => {
      return await http<ProjectProfitAttribution>(
        `/api/import-sales/profit-attribution?startDate=${startDate}&endDate=${endDate}`
      );
    },
    enabled: !!startDate && !!endDate,
  });
};

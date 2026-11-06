/*
New file: frontend/src/features/approvals/hooks/useApprovalsWorkspace.ts
Owns the approvals workspace page's data loading (INV-APPROVALS-SUMMARY-COUNT).

THE RULE (page-composition): page files must go through feature hooks
instead of calling the api layer directly. ApprovalsWorkspacePage used to
import getApprovalRequests / getPendingApprovalsCount / getApprovalRules
from ../api/approvals.api and run its own loadData; that import was a
baselined legacy violation, and the page's spec file importing the same api
module was a NEW violation that turned CI red (Batch 1, run 42088129841).

THE SHAPE: this hook owns exactly the loadData the page used to own --
requests + pending/approved/rejected counts + the active-rules count --
refetching whenever the status/module filters change, and exposing a
reload() the page passes to the rules manager (onRulesChanged) and the
action modal (onSuccess) so summary counts refresh with no page reload.
The hook re-exports the ApprovalRequest / ApprovalRule types so the page
and its spec never import the api module at all.
*/

import { useCallback, useEffect, useState } from 'react';
import {
  getApprovalRequests,
  getApprovalRules,
  getPendingApprovalsCount,
  type ApprovalRequest,
  type ApprovalRule,
} from '../api/approvals.api';

export type { ApprovalRequest, ApprovalRule };

export interface ApprovalsWorkspaceData {
  requests: ApprovalRequest[];
  loading: boolean;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  rulesCount: number;
  reload: () => Promise<void>;
}

export function useApprovalsWorkspace(
  statusFilter: string,
  moduleFilter: string,
): ApprovalsWorkspaceData {
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [approvedCount, setApprovedCount] = useState<number>(0);
  const [rejectedCount, setRejectedCount] = useState<number>(0);
  const [rulesCount, setRulesCount] = useState<number>(0);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [reqData, pendingRes, rulesData] = await Promise.all([
        getApprovalRequests({
          status: statusFilter || undefined,
          module: moduleFilter || undefined,
        }),
        getPendingApprovalsCount(),
        getApprovalRules(),
      ]);

      setRequests(reqData.items || []);
      setPendingCount(pendingRes.count || 0);
      setRulesCount(rulesData.filter((r) => r.is_active).length);

      // Load counts for stats
      const [apprRes, rejRes] = await Promise.all([
        getApprovalRequests({ status: 'approved', limit: 1 }),
        getApprovalRequests({ status: 'rejected', limit: 1 }),
      ]);
      setApprovedCount(apprRes.total || 0);
      setRejectedCount(rejRes.total || 0);
    } catch {
      // Resilience
    } finally {
      setLoading(false);
    }
  }, [statusFilter, moduleFilter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    requests,
    loading,
    pendingCount,
    approvedCount,
    rejectedCount,
    rulesCount,
    reload,
  };
}

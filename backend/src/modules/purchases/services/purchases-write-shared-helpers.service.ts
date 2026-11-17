/**
 * PurchasesWriteSharedHelpersService — slice S2 of the purchases-write split.
 * Pure move of 3 shared helpers from PurchasesWriteService (permission check,
 * manager-approval gate, mutation response builder). No behavior change: the
 * bodies are byte-identical; the facade keeps thin delegates with the same
 * names and signatures. Deps are db + queryService only; no logger. Later
 * slices reach these helpers through the facade own bound methods.
 */
import { Injectable } from '@nestjs/common';
import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { AppError } from '../../../common/errors/app-error';
import { authorizeManagerSecret } from '../../../common/utils/manager-approval';
import { PurchasesQueryService } from './purchases-query.service';

export interface PurchasesWriteSharedHelpersDeps {
  db: Kysely<Database>;
  queryService: PurchasesQueryService;
}

@Injectable()
export class PurchasesWriteSharedHelpersService {
  private readonly db: Kysely<Database>;
  private readonly queryService: PurchasesQueryService;

  constructor(deps: PurchasesWriteSharedHelpersDeps) {
    this.db = deps.db;
    this.queryService = deps.queryService;
  }

  hasPermission(auth: AuthContext, permission: string): boolean {
    return auth.role === 'super_admin' || auth.permissions.includes(permission);
  }

  /*
   * INV-SPIRIT-PURCHASE-MANAGER-APPROVAL: editing or cancelling a
   * purchase reverses stock, supplier and journal balances, so the
   * manager secret the dialogs already collect is actually verified
   * here — it used to travel to the server and be discarded. The rule
   * mirrors sale edit: a non-admin must supply the shared manager PIN
   * or a manager account password; an admin bypasses unless a secret
   * was supplied, in which case it is verified too.
   */
  async assertManagerApprovalForPurchaseChange(secret: string, auth: AuthContext): Promise<void> {
    const isAdmin = auth.role === 'admin' || auth.role === 'super_admin';
    if (!isAdmin && !secret) {
      throw new AppError('رمز اعتماد المدير مطلوب قبل تعديل أو إلغاء فاتورة المشتريات.', 'MANAGER_AUTH_REQUIRED', 400);
    }
    if (!isAdmin || secret) {
      await authorizeManagerSecret(this.db, auth, secret);
    }
  }

  async buildPurchaseMutationResponse(
    purchaseId: number,
    auth: AuthContext,
    extras: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const purchaseResult = await this.queryService.getPurchaseById(purchaseId, auth);
    const purchases = await this.queryService.listPurchases({ page: 1, pageSize: 25 }, auth);
    return { ok: true, purchaseId, purchase: purchaseResult.purchase, purchases: purchases.purchases, ...extras };
  }
}

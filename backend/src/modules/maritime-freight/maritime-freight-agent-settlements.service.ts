import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { convertFxAmount } from '../accounting/engines/fx-conversion.engine';
import { currencyMoneyDigits } from '../accounting/engines/money-minor-units.engine';
import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from '../../database/kysely';
import { type Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import * as crypto from 'crypto';
import { formatDailyDocumentNumber } from '../../common/utils/document-number.util';
import { getTenantTimezone } from '../../common/utils/tenant-timezone.util';
import { CreateAgentSettlementDto, UpdateAgentSettlementStatusDto } from './dto/agent-settlement.dto';

/**
 * MaritimeFreightAgentSettlementsService — slice S7 of the maritime-freight split.
 * Pure move of 4 methods from MaritimeFreightService (Overseas Agent
 * Settlements & Profit Sharing — SOA). No behavior change: the bodies
 * are byte-identical; the facade keeps thin delegates with the same
 * names and signatures. Deps are db + the BOUND KERNEL
 * resolveFreightExchangeRate (S3 pattern — the kernel stays in the
 * facade; createAgentSettlement calls it ONCE, BEFORE its tx opens,
 * so the tx has no callees and no PGlite hang shape); no mail/
 * WhatsApp/posting, no cross-slice deps. No visibility change — all 4
 * methods are public. The slice declares NO Logger (S7 is not one of
 * the 6 logger slices). createAgentSettlement is PINNED
 * (maritime-agent-settlement-record-integrity +
 * maritime-settlement-rate-resolved drive it) — no spec repoint
 * travels in this patch, merge-owned. Clock travels verbatim: 1 bare
 * new Date() (createAgentSettlement, inside the tx as a
 * formatDailyDocumentNumber arg) + 1 getTenantTimezone(trx, ...)
 * (trx-threaded) — pure moves, no UTC-slice normalizer, no instant
 * comparison. Guard: currencyMoneyDigits( x1 (createAgentSettlement
 * — book-digits local equivalent), this.db.transaction( x1 (SAFE tx:
 * no callees inside). The SOA banner travels byte-identical into the
 * slice (file #8 S9 precedent); the Inland Trucking banner stays in
 * the facade (it precedes listInlandTruckingTrips, S16).
 */

export interface MaritimeFreightAgentSettlementsDeps {
  db: Kysely<Database>;
  // Bound kernel helper (same name as the facade member, so the moved
  // bodies are byte-identical). resolveFreightExchangeRate stays in the
  // facade forever (kernel).
  resolveFreightExchangeRate: (
    tenantId: string,
    currency: string | undefined,
    suppliedRate?: number,
    asOf?: Date | string,
  ) => Promise<number>;
}

@Injectable()
export class MaritimeFreightAgentSettlementsService {
  private readonly db: Kysely<Database>;
  private readonly resolveFreightExchangeRate: (
    tenantId: string,
    currency: string | undefined,
    suppliedRate?: number,
    asOf?: Date | string,
  ) => Promise<number>;

  constructor(deps: MaritimeFreightAgentSettlementsDeps) {
    this.db = deps.db;
    this.resolveFreightExchangeRate = deps.resolveFreightExchangeRate;
  }

  // ==========================================
  // 4. Overseas Agent Settlements & Profit Sharing (SOA)
  // ==========================================

  async listAgentSettlements(auth: AuthContext, filters?: { agentId?: string; status?: string; search?: string }) {
    const { tenantId } = requireTenantScope(auth);
    let query = this.db.selectFrom('maritime_agent_settlements').selectAll().where('tenant_id', '=', tenantId);

    if (filters?.agentId) {
      query = query.where('agent_id', '=', String(filters.agentId));
    }
    if (filters?.status && filters.status !== 'all') {
      query = query.where('status', '=', filters.status as any);
    }
    if (filters?.search) {
      const term = `%${filters.search}%`;
      query = query.where((eb) =>
        eb.or([
          eb('agent_name', 'ilike', term),
          eb('job_number', 'ilike', term),
          eb('reference_number', 'ilike', term),
        ]),
      );
    }

    return await query.orderBy('id', 'desc').execute();
  }

  async createAgentSettlement(auth: AuthContext, dto: CreateAgentSettlementDto) {
    const { tenantId } = requireTenantScope(auth);
    const amount = Number(dto.amount || 0);
    // INV-MARITIME-SETTLEMENT-RATE-RESOLVED: never assume parity. The
    // settlement currency defaults to USD (freight's domain
    // currency), so an omitted rate resolves through the same
    // registered-rate resolver every other maritime path uses: 1
    // only for the tenant base currency, a supplied positive rate,
    // or the registered rate — fail closed when none exists.
    const currency = dto.currency || 'USD';
    const rate = await this.resolveFreightExchangeRate(tenantId, currency, dto.exchangeRate, new Date());
    // INV-MARITIME-AGENT-SETTLEMENT-RECORD-INTEGRITY: the local
    // equivalent converts at the tenant's book digits through the
    // shared engine -- the raw float product stored 4856.0625 for a
    // KWD tenant, a fourth decimal the books cannot hold.
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const localEq = convertFxAmount(amount, rate, digits);

    const settlementPrefix =
      dto.settlementType === 'debit_note' ? 'ADN' : dto.settlementType === 'credit_note' ? 'ACN' : 'APS';
    const suppliedRef = dto.referenceNumber?.trim() || null;

    // The generated reference number follows the module-wide
    // collision-proof pattern (insert with a temp value, rename by
    // the returned identity in the same transaction): the previous
    // random 4-digit sequence could repeat on the same day. A
    // caller-supplied number is kept verbatim.
    const settlement = await this.db.transaction().execute(async (trx: any) => {
      const [row] = await trx
        .insertInto('maritime_agent_settlements')
        .values({
          tenant_id: tenantId,
          agent_id: dto.agentId ? String(dto.agentId) : null,
          agent_name: dto.agentName,
          job_id: dto.jobId ? String(dto.jobId) : null,
          job_number: dto.jobNumber || null,
          settlement_type: dto.settlementType,
          currency: currency,
          amount: amount,
          profit_share_percent: dto.profitSharePercent !== undefined ? Number(dto.profitSharePercent) : 50,
          local_equivalent_amount: localEq,
          exchange_rate: rate,
          reference_number: suppliedRef || `AST-TMP-${crypto.randomUUID()}`,
          status: 'pending',
          notes: dto.notes || null,
        })
        .returningAll()
        .execute();

      if (suppliedRef) return row;
      const [renamed] = await trx
        .updateTable('maritime_agent_settlements')
        .set({
          reference_number: formatDailyDocumentNumber(
            settlementPrefix,
            Number(row.id),
            new Date(),
            4,
            await getTenantTimezone(trx, tenantId),
          ),
        })
        .where('id', '=', row.id)
        .where('tenant_id', '=', tenantId)
        .returningAll()
        .execute();
      return renamed;
    });

    return settlement;
  }

  async updateAgentSettlementStatus(auth: AuthContext, id: string | number, dto: UpdateAgentSettlementStatusDto) {
    const { tenantId } = requireTenantScope(auth);
    const [updated] = await this.db
      .updateTable('maritime_agent_settlements')
      .set({
        status: dto.status,
        notes: dto.notes !== undefined ? dto.notes : undefined,
        updated_at: sql`NOW()`,
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', String(id))
      .returningAll()
      .execute();

    return updated;
  }

  async getAgentStatementOfAccount(auth: AuthContext, agentId: string | number) {
    const { tenantId } = requireTenantScope(auth);
    const settlements = await this.db
      .selectFrom('maritime_agent_settlements')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('agent_id', '=', String(agentId))
      .orderBy('id', 'asc')
      .execute();

    let totalDebit = 0;
    let totalCredit = 0;

    for (const item of settlements) {
      const amt = Number(item.amount || 0);
      if (item.settlement_type === 'debit_note' || item.settlement_type === 'profit_share') {
        totalDebit += amt;
      } else if (item.settlement_type === 'credit_note') {
        totalCredit += amt;
      }
    }

    const netBalance = totalDebit - totalCredit;

    return {
      agentId: String(agentId),
      settlements,
      summary: {
        totalDebitUsd: totalDebit,
        totalCreditUsd: totalCredit,
        netBalanceUsd: netBalance,
        position: netBalance >= 0 ? 'receivable' : 'payable',
      },
    };
  }
}

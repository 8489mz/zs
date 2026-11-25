import { roundMoney, type MoneyDigits } from '../engines/money-minor-units.engine';
import { Inject, Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { AccountingPostingService } from '../accounting-posting.service';
import type {
  PdcChequeRecord,
  PdcChequesFilter,
  PdcChequesStats,
  CreatePdcChequeDto,
  UpdateChequeStatusDto,
} from './pdc-cheques/pdc-cheques.types';
export type {
  PdcChequeRecord,
  PdcChequesFilter,
  PdcChequesStats,
  CreatePdcChequeDto,
  UpdateChequeStatusDto,
} from './pdc-cheques/pdc-cheques.types';
import { ListChequesSlice } from './pdc-cheques/list-cheques.slice';
import { ChequesStatsSlice } from './pdc-cheques/cheques-stats.slice';
import { CreateChequeSlice } from './pdc-cheques/create-cheque.slice';
import { UpdateChequeStatusSlice } from './pdc-cheques/update-cheque-status.slice';
import { SyncSubLedgersSlice } from './pdc-cheques/sync-sub-ledgers.slice';
import { DeleteChequeSlice } from './pdc-cheques/delete-cheque.slice';

@Injectable()
export class PdcChequesService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly accountingPostingService: AccountingPostingService,
  ) {}

  private toMoney(value: unknown, digits: MoneyDigits): number {
    const n = Number(value || 0);
    return Number.isFinite(n) ? roundMoney(n, digits) : 0;
  }

  private formatDate(date: any): string {
    if (!date) return '';
    if (typeof date === 'string') return date.substring(0, 10);
    if (date instanceof Date) return date.toISOString().substring(0, 10);
    return String(date).substring(0, 10);
  }

  private listChequesSliceInstance?: ListChequesSlice;
  private get listChequesSlice(): ListChequesSlice {
    return (this.listChequesSliceInstance ??= new ListChequesSlice(this.db, {
      toMoney: (value, digits) => this.toMoney(value, digits),
      formatDate: (date) => this.formatDate(date),
    }));
  }

  private chequesStatsSliceInstance?: ChequesStatsSlice;
  private get chequesStatsSlice(): ChequesStatsSlice {
    return (this.chequesStatsSliceInstance ??= new ChequesStatsSlice(this.db, {
      toMoney: (value, digits) => this.toMoney(value, digits),
      formatDate: (date) => this.formatDate(date),
    }));
  }

  private createChequeSliceInstance?: CreateChequeSlice;
  private get createChequeSlice(): CreateChequeSlice {
    return (this.createChequeSliceInstance ??= new CreateChequeSlice(this.db, this.accountingPostingService, {
      toMoney: (value, digits) => this.toMoney(value, digits),
      formatDate: (date) => this.formatDate(date),
      syncCustomerSubLedger: (trx, auth, customerId, amount, entryType, note, chequeId) =>
        this.syncCustomerSubLedger(trx, auth, customerId, amount, entryType, note, chequeId),
      syncSupplierSubLedger: (trx, auth, supplierId, amount, entryType, note, chequeId) =>
        this.syncSupplierSubLedger(trx, auth, supplierId, amount, entryType, note, chequeId),
    }));
  }

  private updateChequeStatusSliceInstance?: UpdateChequeStatusSlice;
  private get updateChequeStatusSlice(): UpdateChequeStatusSlice {
    return (this.updateChequeStatusSliceInstance ??= new UpdateChequeStatusSlice(
      this.db,
      this.accountingPostingService,
      {
        toMoney: (value, digits) => this.toMoney(value, digits),
        formatDate: (date) => this.formatDate(date),
        syncCustomerSubLedger: (trx, auth, customerId, amount, entryType, note, chequeId) =>
          this.syncCustomerSubLedger(trx, auth, customerId, amount, entryType, note, chequeId),
        syncSupplierSubLedger: (trx, auth, supplierId, amount, entryType, note, chequeId) =>
          this.syncSupplierSubLedger(trx, auth, supplierId, amount, entryType, note, chequeId),
      },
    ));
  }

  private syncSubLedgersSliceInstance?: SyncSubLedgersSlice;
  private get syncSubLedgersSlice(): SyncSubLedgersSlice {
    return (this.syncSubLedgersSliceInstance ??= new SyncSubLedgersSlice());
  }

  private deleteChequeSliceInstance?: DeleteChequeSlice;
  private get deleteChequeSlice(): DeleteChequeSlice {
    return (this.deleteChequeSliceInstance ??= new DeleteChequeSlice(this.db));
  }

  async listCheques(
    authContext: AuthContext,
    filters: PdcChequesFilter = {},
  ): Promise<{
    data: PdcChequeRecord[];
    total: number;
    page: number;
    limit: number;
    serverTime: string;
    serverTimezone: string;
  }> {
    return this.listChequesSlice.listCheques(authContext, filters);
  }

  async getStats(authContext: AuthContext): Promise<PdcChequesStats> {
    return this.chequesStatsSlice.getStats(authContext);
  }

  async createCheque(authContext: AuthContext, dto: CreatePdcChequeDto): Promise<PdcChequeRecord> {
    return this.createChequeSlice.createCheque(authContext, dto);
  }

  async updateChequeStatus(
    authContext: AuthContext,
    id: number,
    actionDto: UpdateChequeStatusDto,
  ): Promise<PdcChequeRecord> {
    return this.updateChequeStatusSlice.updateChequeStatus(authContext, id, actionDto);
  }

  private async syncCustomerSubLedger(
    trx: any,
    auth: AuthContext,
    customerId: number,
    amount: number,
    entryType: string,
    note: string,
    chequeId: number,
  ): Promise<void> {
    return this.syncSubLedgersSlice.syncCustomerSubLedger(trx, auth, customerId, amount, entryType, note, chequeId);
  }
  private async syncSupplierSubLedger(
    trx: any,
    auth: AuthContext,
    supplierId: number,
    amount: number,
    entryType: string,
    note: string,
    chequeId: number,
  ): Promise<void> {
    return this.syncSubLedgersSlice.syncSupplierSubLedger(trx, auth, supplierId, amount, entryType, note, chequeId);
  }

  async deleteCheque(authContext: AuthContext, id: number): Promise<{ success: boolean }> {
    return this.deleteChequeSlice.deleteCheque(authContext, id);
  }
}

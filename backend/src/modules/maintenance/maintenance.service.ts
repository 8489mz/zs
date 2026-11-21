import { Inject, Injectable } from '@nestjs/common';
import { Kysely } from '../../database/kysely';
import { AuditService } from '../../core/audit/audit.service';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { TransactionHelper } from '../../database/helpers/transaction.helper';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../accounting/accounting-tenant-foundation.service';
import { toMinorUnits } from '../accounting/engines/money-minor-units.engine';
import { UpsertMaintenanceTicketDto } from './dto/upsert-maintenance-ticket.dto';
import { UpdateTicketStatusDto, AddTicketPartDto } from './dto/update-ticket-status.dto';
import { TicketListingSlice } from './maintenance/ticket-listing.slice';
import { CreateTicketSlice } from './maintenance/create-ticket.slice';
import { UpdateTicketSlice } from './maintenance/update-ticket.slice';
import { UpdateTicketStatusSlice } from './maintenance/update-ticket-status.slice';
import { TicketPartsSlice } from './maintenance/ticket-parts.slice';
import { DeleteTicketSlice } from './maintenance/delete-ticket.slice';
export { computeWarrantyEnd, findSoldSerialSaleId, isFinancialTicketChange, buildNonFinancialTicketUpdate, resolveQuoteFields, assertInProgressQuoteAllowed } from './maintenance/maintenance-helpers';

@Injectable()
export class MaintenanceService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly audit: AuditService,
    private readonly accountingPosting: AccountingPostingService,
    private readonly accountingFoundation: AccountingTenantFoundationService,
  ) {}

  private isExactMaintenanceSettlement(remaining: number, advance: number, total: number, digits: 2 | 3): boolean {
    try {
      return toMinorUnits(remaining, digits) + toMinorUnits(advance, digits) === toMinorUnits(total, digits);
    } catch {
      return false;
    }
  }

  private ticketListingSliceInstance?: TicketListingSlice;
  private get ticketListingSlice(): TicketListingSlice {
    return (this.ticketListingSliceInstance ??= new TicketListingSlice(
      this.db,
    ));
  }

  private createTicketSliceInstance?: CreateTicketSlice;
  private get createTicketSlice(): CreateTicketSlice {
    return (this.createTicketSliceInstance ??= new CreateTicketSlice(
      this.db,
      this.tx,
      this.audit,
      this.accountingPosting,
      this.accountingFoundation,
    ));
  }

  private updateTicketSliceInstance?: UpdateTicketSlice;
  private get updateTicketSlice(): UpdateTicketSlice {
    return (this.updateTicketSliceInstance ??= new UpdateTicketSlice(
      this.db,
      this.tx,
      this.audit,
    ));
  }

  private updateTicketStatusSliceInstance?: UpdateTicketStatusSlice;
  private get updateTicketStatusSlice(): UpdateTicketStatusSlice {
    return (this.updateTicketStatusSliceInstance ??= new UpdateTicketStatusSlice(
      this.db,
      this.tx,
      this.audit,
      this.accountingPosting,
      this.accountingFoundation,
      {
        isExactMaintenanceSettlement: (remaining, advance, total, digits) =>
          this.isExactMaintenanceSettlement(remaining, advance, total, digits),
      },
    ));
  }

  private ticketPartsSliceInstance?: TicketPartsSlice;
  private get ticketPartsSlice(): TicketPartsSlice {
    return (this.ticketPartsSliceInstance ??= new TicketPartsSlice(
      this.db,
      this.tx,
      this.accountingPosting,
      this.accountingFoundation,
    ));
  }

  private deleteTicketSliceInstance?: DeleteTicketSlice;
  private get deleteTicketSlice(): DeleteTicketSlice {
    return (this.deleteTicketSliceInstance ??= new DeleteTicketSlice(
      this.db,
      this.tx,
      this.audit,
      this.accountingPosting,
      this.accountingFoundation,
    ));
  }


  async listTickets(
      auth: AuthContext,
      filters?: {
        status?: string;
        q?: string;
        page?: number;
        pageSize?: number;
      },
    ) {
    return this.ticketListingSlice.listTickets(auth, filters);
  }

  async getTicketCounts(auth: AuthContext) {
    return this.ticketListingSlice.getTicketCounts(auth);
  }

  async getTicket(id: number, auth: AuthContext) {
    return this.ticketListingSlice.getTicket(id, auth);
  }

  async createTicket(payload: UpsertMaintenanceTicketDto, auth: AuthContext) {
    return this.createTicketSlice.createTicket(payload, auth);
  }

  async updateTicket(id: number, payload: UpsertMaintenanceTicketDto, auth: AuthContext) {
    return this.updateTicketSlice.updateTicket(id, payload, auth);
  }

  async updateTicketStatus(id: number, payload: UpdateTicketStatusDto, auth: AuthContext) {
    return this.updateTicketStatusSlice.updateTicketStatus(id, payload, auth);
  }

  async addPart(ticketId: number, payload: AddTicketPartDto, auth: AuthContext) {
    return this.ticketPartsSlice.addPart(ticketId, payload, auth);
  }

  async removePart(ticketId: number, partId: number, auth: AuthContext) {
    return this.ticketPartsSlice.removePart(ticketId, partId, auth);
  }

  async deleteTicket(id: number, auth: AuthContext) {
    return this.deleteTicketSlice.deleteTicket(id, auth);
  }
}

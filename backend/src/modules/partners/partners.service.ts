import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { AuditService } from '../../core/audit/audit.service';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { UpsertCustomerDto } from './dto/upsert-customer.dto';
import { UpsertSupplierDto } from './dto/upsert-supplier.dto';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { CustomerOpeningBalancesSlice } from './partners/customer-opening-balances.slice';
import { CustomerListingSlice } from './partners/customer-listing.slice';
import { CustomerAddressesPosSlice } from './partners/customer-addresses-pos.slice';
import { CustomerDeliveryProfileSlice } from './partners/customer-delivery-profile.slice';
import { CustomerCrudSlice } from './partners/customer-crud.slice';
import { SupplierCrudSlice } from './partners/supplier-crud.slice';
import { PartnerContactsLoyaltySlice } from './partners/partner-contacts-loyalty.slice';

@Injectable()
export class PartnersService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly accountingPosting: AccountingPostingService,
  ) {}

  private tenantId(actor: AuthContext): string {
    return requireTenantScope(actor).tenantId;
  }

  private accountId(actor: AuthContext): string {
    return requireTenantScope(actor).accountId;
  }

  private tenantPredicate(actor: AuthContext, alias?: string) {
    return alias
      ? sql<boolean>`${sql.ref(`${alias}.tenant_id`)} = ${this.tenantId(actor)}`
      : sql<boolean>`tenant_id = ${this.tenantId(actor)}`;
  }

  private tenantFields(actor: AuthContext) {
    return { tenant_id: this.tenantId(actor), account_id: this.accountId(actor) };
  }

  private customerOpeningBalancesSliceInstance?: CustomerOpeningBalancesSlice;
  private get customerOpeningBalancesSlice(): CustomerOpeningBalancesSlice {
    return (this.customerOpeningBalancesSliceInstance ??= new CustomerOpeningBalancesSlice(
      this.db,
      this.accountingPosting,
      {
        tenantPredicate: (actor, alias) =>
          this.tenantPredicate(actor, alias),
        tenantId: (actor) =>
          this.tenantId(actor),
        tenantFields: (actor) =>
          this.tenantFields(actor),
      },
    ));
  }

  private customerListingSliceInstance?: CustomerListingSlice;
  private get customerListingSlice(): CustomerListingSlice {
    return (this.customerListingSliceInstance ??= new CustomerListingSlice(
      this.db,
      {
        tenantPredicate: (actor, alias) =>
          this.tenantPredicate(actor, alias),
        tenantId: (actor) =>
          this.tenantId(actor),
      },
    ));
  }

  private customerAddressesPosSliceInstance?: CustomerAddressesPosSlice;
  private get customerAddressesPosSlice(): CustomerAddressesPosSlice {
    return (this.customerAddressesPosSliceInstance ??= new CustomerAddressesPosSlice(
      this.db,
      {
        tenantPredicate: (actor, alias) =>
          this.tenantPredicate(actor, alias),
        tenantId: (actor) =>
          this.tenantId(actor),
        getCustomerAddresses: (id, actor) =>
          this.customerListingSlice.getCustomerAddresses(id, actor),
      },
    ));
  }

  private customerDeliveryProfileSliceInstance?: CustomerDeliveryProfileSlice;
  private get customerDeliveryProfileSlice(): CustomerDeliveryProfileSlice {
    return (this.customerDeliveryProfileSliceInstance ??= new CustomerDeliveryProfileSlice(
      this.db,
      {
        tenantPredicate: (actor, alias) =>
          this.tenantPredicate(actor, alias),
        extractCustomerAddresses: (customerAddress, metadata, rawSalesAddresses) =>
          this.customerListingSlice.extractCustomerAddresses(customerAddress, metadata, rawSalesAddresses),
      },
    ));
  }

  private customerCrudSliceInstance?: CustomerCrudSlice;
  private get customerCrudSlice(): CustomerCrudSlice {
    return (this.customerCrudSliceInstance ??= new CustomerCrudSlice(
      this.db,
      this.audit,
      {
        tenantPredicate: (actor, alias) =>
          this.tenantPredicate(actor, alias),
        tenantId: (actor) =>
          this.tenantId(actor),
        tenantFields: (actor) =>
          this.tenantFields(actor),
        customerNameExists: (name, actor, excludeId) =>
          this.customerOpeningBalancesSlice.customerNameExists(name, actor, excludeId),
        findCustomerByPhone: (phone, actor, excludeId) =>
          this.customerOpeningBalancesSlice.findCustomerByPhone(phone, actor, excludeId),
        buildDuplicatePhoneWarning: (existing) =>
          this.customerOpeningBalancesSlice.buildDuplicatePhoneWarning(existing),
        addCustomerOpeningBalance: (customerId, amount, actor, db) =>
          this.customerOpeningBalancesSlice.addCustomerOpeningBalance(customerId, amount, actor, db),
        listCustomers: (query, actor) =>
          this.customerListingSlice.listCustomers(query, actor),
      },
    ));
  }

  private supplierCrudSliceInstance?: SupplierCrudSlice;
  private get supplierCrudSlice(): SupplierCrudSlice {
    return (this.supplierCrudSliceInstance ??= new SupplierCrudSlice(
      this.db,
      this.audit,
      {
        tenantPredicate: (actor, alias) =>
          this.tenantPredicate(actor, alias),
        tenantId: (actor) =>
          this.tenantId(actor),
        tenantFields: (actor) =>
          this.tenantFields(actor),
        supplierNameExists: (name, actor, excludeId) =>
          this.customerOpeningBalancesSlice.supplierNameExists(name, actor, excludeId),
        addSupplierOpeningBalance: (supplierId, amount, actor, db) =>
          this.customerOpeningBalancesSlice.addSupplierOpeningBalance(supplierId, amount, actor, db),
      },
    ));
  }

  private partnerContactsLoyaltySliceInstance?: PartnerContactsLoyaltySlice;
  private get partnerContactsLoyaltySlice(): PartnerContactsLoyaltySlice {
    return (this.partnerContactsLoyaltySliceInstance ??= new PartnerContactsLoyaltySlice(
      this.db,
      this.audit,
      {
        tenantPredicate: (actor, alias) =>
          this.tenantPredicate(actor, alias),
        tenantFields: (actor) =>
          this.tenantFields(actor),
        tenantId: (actor) =>
          this.tenantId(actor),
        accountId: (actor) =>
          this.accountId(actor),
      },
    ));
  }


  private async addCustomerOpeningBalance(customerId: number, amount: number, actor: AuthContext, db: Kysely<Database>): Promise<void> {
    return this.customerOpeningBalancesSlice.addCustomerOpeningBalance(customerId, amount, actor, db);
  }

  private async addSupplierOpeningBalance(supplierId: number, amount: number, actor: AuthContext, db: Kysely<Database>): Promise<void> {
    return this.customerOpeningBalancesSlice.addSupplierOpeningBalance(supplierId, amount, actor, db);
  }

  async listCustomers(query: Record<string, unknown>, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.customerListingSlice.listCustomers(query, actor);
  }

  async getCustomerAddresses(id: number, actor: AuthContext): Promise<string[]> {
    return this.customerListingSlice.getCustomerAddresses(id, actor);
  }

  async addCustomerAddress(id: number, newAddress: string, actor: AuthContext): Promise<{ ok: boolean; addresses: string[] }> {
    return this.customerAddressesPosSlice.addCustomerAddress(id, newAddress, actor);
  }

  async deleteCustomerAddress(id: number, addressToDelete: string, actor: AuthContext): Promise<{ ok: boolean; addresses: string[] }> {
    return this.customerAddressesPosSlice.deleteCustomerAddress(id, addressToDelete, actor);
  }

  async getCustomerPosSummary(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.customerAddressesPosSlice.getCustomerPosSummary(id, actor);
  }

  async lookupCustomerDeliveryProfile(phoneQuery: string, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.customerDeliveryProfileSlice.lookupCustomerDeliveryProfile(phoneQuery, actor);
  }

  async getCustomerDeliveryProfile(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.customerDeliveryProfileSlice.getCustomerDeliveryProfile(id, actor);
  }

  async createCustomer(payload: UpsertCustomerDto, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.customerCrudSlice.createCustomer(payload, actor);
  }

  async updateCustomer(id: number, payload: UpsertCustomerDto, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.customerCrudSlice.updateCustomer(id, payload, actor);
  }

  async deleteCustomer(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.customerCrudSlice.deleteCustomer(id, actor);
  }

  async listSuppliers(query: Record<string, unknown>, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.supplierCrudSlice.listSuppliers(query, actor);
  }

  async createSupplier(payload: UpsertSupplierDto, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.supplierCrudSlice.createSupplier(payload, actor);
  }

  async updateSupplier(id: number, payload: UpsertSupplierDto, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.supplierCrudSlice.updateSupplier(id, payload, actor);
  }

  async deleteSupplier(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.supplierCrudSlice.deleteSupplier(id, actor);
  }

  async listContacts(partnerType: string, partnerId: number, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.partnerContactsLoyaltySlice.listContacts(partnerType, partnerId, actor);
  }

  async createContact(partnerType: string, partnerId: number, payload: any, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.partnerContactsLoyaltySlice.createContact(partnerType, partnerId, payload, actor);
  }

  async listAddresses(partnerType: string, partnerId: number, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.partnerContactsLoyaltySlice.listAddresses(partnerType, partnerId, actor);
  }

  async createAddress(partnerType: string, partnerId: number, payload: any, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.partnerContactsLoyaltySlice.createAddress(partnerType, partnerId, payload, actor);
  }

  async adjustCustomerLoyaltyPoints(
      id: number,
      pointsChange: number,
      actionType: 'earn' | 'redeem' | 'manual_adjust',
      notes: string | undefined,
      actor: AuthContext,
    ): Promise<Record<string, unknown>> {
    return this.partnerContactsLoyaltySlice.adjustCustomerLoyaltyPoints(id, pointsChange, actionType, notes, actor);
  }

  async getCustomerLoyaltyHistory(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.partnerContactsLoyaltySlice.getCustomerLoyaltyHistory(id, actor);
  }

  async getInactiveCustomersMarketing(daysInactive = 30, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.partnerContactsLoyaltySlice.getInactiveCustomersMarketing(daysInactive, actor);
  }
}

export type { MaritimeMailConfig } from '../maritime-freight.types';
export type { ShippingPort, ShippingLine, ContainerTypeSpec, IncotermRule, PortTerminal, ReferenceDataResponse, MaritimeRfqBid, MaritimeRfq, MaritimePipelineConfig, MaritimeQuotation, MaritimeContainer, CreateMaritimeContainerPayload, UpdateMaritimeContainerPayload, MaritimeMilestone, MaritimeJob, CargoInsurance, WarehouseReceipt, MaritimeInlandTruckingTrip, MaritimeJobDocument } from './maritime-freight/maritime-freight-types';
export { maritimeApi } from './maritime-freight/maritime-freight-api-core';
export type { MaritimeCustomsDeclaration, MaritimeCustomsDeclarationItem, MaritimeRateCard, MaritimeCarrierInvoice, FreightAuditPreview, FreightPortalCustomer, FreightPortalSession, FreightPortalDashboard } from './maritime-freight/maritime-freight-portal-types';
export { freightCustomerPortalApi } from './maritime-freight/maritime-freight-portal-api';

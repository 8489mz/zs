import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { CarrierTrackingEventDto } from './dto/carrier-tracking.dto';

/**
 * MaritimeFreightTrackingService — slice S8 of the maritime-freight split.
 * Pure move of 3 methods from MaritimeFreightService (carrier tracking:
 * estimated/scheduled timeline events, API event recording + reads).
 * No behavior change: the bodies are byte-identical; the facade keeps
 * thin delegates with the same names and signatures for all 3 methods.
 * Deps are db only; no cross-slice deps, no mail/WhatsApp/posting, no
 * Logger (the moved text never logs). The section banner
 * ("6. Carrier Tracking Hub & API Events (estimated/scheduled only)")
 * travels with its section (prep §2, file #8 S9 precedent) — with the
 * blank line below it, as in the pristine file. Date handling travels
 * verbatim: syncCarrierTracking carries new Date(Date.now() - ...) for
 * the estimated offsets and recordCarrierApiEvent carries
 * new Date(dto.eventTime); no instant comparison, no UTC-slice
 * normalizer. No transaction in this slice (no PGlite hang shape —
 * prep §9). syncCarrierTracking is PINNED (maritime-tracking-honest-
 * labelling): its INV-MARITIME-TRACKING-HONEST-LABELLING comment +
 * 'estimated' + ESTIMATED_SCHEDULE travel with it; the method bodies
 * carry none of the forbidden live-feed markers. No spec repoint travels
 * in this patch — merge-owned (tracking-honest-labelling #19: the
 * range → this slice file, the whole-module assertions → a
 * concatenated read).
 */

export interface MaritimeFreightTrackingDeps {
  db: Kysely<Database>;
}

@Injectable()
export class MaritimeFreightTrackingService {
  private readonly db: Kysely<Database>;

  constructor(deps: MaritimeFreightTrackingDeps) {
    this.db = deps.db;
  }

  // ==========================================
  // 6. Carrier Tracking Hub & API Events (estimated/scheduled only)
  // ==========================================

  async syncCarrierTracking(auth: AuthContext, carrierCode: string, trackingNumber: string) {
    const { tenantId } = requireTenantScope(auth);

    // INV-MARITIME-TRACKING-HONEST-LABELLING: there is NO live
    // carrier integration anywhere in this module (zero fetch calls):
    // these are estimated, scheduled timeline events derived from
    // fixed offsets, labelled as such in the stored payload, the
    // returned status and the frontend copy. They must never be
    // presented as a live carrier synchronisation.
    const estimatedEvents = [
      { eventType: 'BOOK', eventLocation: 'Port Origin', hoursAgo: 72, label: 'Booking Confirmed with Carrier' },
      { eventType: 'GTI', eventLocation: 'Terminal Gate-in', hoursAgo: 48, label: 'Container Gate-in at POL' },
      { eventType: 'LOAD', eventLocation: 'Vessel Berth', hoursAgo: 24, label: 'Loaded on Vessel' },
      { eventType: 'DEPT', eventLocation: 'En Route Sea', hoursAgo: 12, label: 'Vessel Departed Origin Port' },
    ];

    for (const evt of estimatedEvents) {
      const eventTime = new Date(Date.now() - evt.hoursAgo * 3600 * 1000);
      await this.db
        .insertInto('maritime_carrier_api_events')
        .values({
          tenant_id: tenantId,
          carrier_code: carrierCode.toUpperCase(),
          tracking_number: trackingNumber,
          event_type: evt.eventType,
          event_location: evt.eventLocation,
          event_time: eventTime,
          raw_payload: JSON.stringify({ source: 'ESTIMATED_SCHEDULE', estimated: true, note: evt.label }),
        })
        .execute();
    }

    return {
      carrierCode: carrierCode.toUpperCase(),
      trackingNumber,
      status: 'estimated',
      estimated: true,
      eventsCount: estimatedEvents.length,
      lastEvent: estimatedEvents[estimatedEvents.length - 1],
    };
  }

  async recordCarrierApiEvent(auth: AuthContext, dto: CarrierTrackingEventDto) {
    const { tenantId } = requireTenantScope(auth);
    const [event] = await this.db
      .insertInto('maritime_carrier_api_events')
      .values({
        tenant_id: tenantId,
        carrier_code: dto.carrierCode.toUpperCase(),
        tracking_number: dto.trackingNumber,
        event_type: dto.eventType,
        event_location: dto.eventLocation || null,
        event_time: dto.eventTime ? new Date(dto.eventTime) : sql`NOW()`,
        raw_payload: dto.rawPayload ? JSON.stringify(dto.rawPayload) : null,
      })
      .returningAll()
      .execute();

    return event;
  }

  async listCarrierApiEvents(auth: AuthContext, trackingNumber: string) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db
      .selectFrom('maritime_carrier_api_events')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('tracking_number', '=', trackingNumber)
      .orderBy('event_time', 'desc')
      .execute();
  }
}

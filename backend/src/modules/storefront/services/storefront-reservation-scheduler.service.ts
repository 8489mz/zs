import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { StorefrontService } from '../storefront.service';

/**
 * Periodically sweeps and reaps expired online order reservations across all tenants.
 * Prevents Denial-of-Inventory (DOI) attacks where unpaid/abandoned checkout sessions
 * permanently hold stock in `product_location_stock` and block cashier POS sales.
 */

// D-SF-12: a sweep that never settles used to wedge `running` true forever with no
// timeout and no trace — a single hung sweep killed the scheduler permanently.
// A sweep older than this is treated as wedged: it is reset + logged, never trusted.
const SWEEP_STALE_MS = 5 * 60 * 1000;

/** Last sweep attempt, persisted like DatabaseMaintenanceService._lastResults. */
export interface ReaperHeartbeat {
  type: 'storefront_reservation_sweep';
  completedAt: string;
  scannedCount: number;
  reapedOrdersCount: number;
  reapedOrderNumbers: string[];
  skippedWhileRunning: boolean;
  wedgedReset: boolean;
  error: string | null;
}

@Injectable()
export class StorefrontReservationSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(StorefrontReservationSchedulerService.name);
  private timer?: ReturnType<typeof setInterval>;
  private startup?: ReturnType<typeof setTimeout>;
  private running = false;
  private sweepStartedAt?: number;

  private static _lastResults: ReaperHeartbeat | null = null;

  constructor(private readonly storefrontService: StorefrontService) {}

  getLastResults(): ReaperHeartbeat | null {
    return StorefrontReservationSchedulerService._lastResults;
  }

  onApplicationBootstrap(): void {
    // Initial sweep 30s after startup to clean any reservations left over from server restart
    this.startup = setTimeout(() => {
      void this.sweepExpiredReservations();
    }, 30_000);

    // Periodic sweep every 2 minutes (120,000 ms)
    this.timer = setInterval(() => {
      void this.sweepExpiredReservations();
    }, 2 * 60 * 1000);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.startup) {
      clearTimeout(this.startup);
      this.startup = undefined;
    }
  }

  async sweepExpiredReservations(): Promise<void> {
    let wedgedReset = false;
    if (this.running) {
      const startedAt = this.sweepStartedAt ?? 0;
      if (Date.now() - startedAt > SWEEP_STALE_MS) {
        // D-SF-12: the previous sweep never settled — reset the guard and
        // run a fresh sweep instead of staying wedged forever.
        this.logger.warn(
          'Automated reservation reaper: previous sweep wedged, resetting the running guard.',
        );
        this.running = false;
        wedgedReset = true;
      } else {
        // D-SF-12: a skipped sweep must leave a trace — silence here is
        // what made a dead scheduler indistinguishable from "nothing expired".
        this.logger.warn('Automated reservation reaper: sweep skipped, previous sweep still running.');
        StorefrontReservationSchedulerService._lastResults = {
          type: 'storefront_reservation_sweep',
          completedAt: new Date().toISOString(),
          scannedCount: 0,
          reapedOrdersCount: 0,
          reapedOrderNumbers: [],
          skippedWhileRunning: true,
          wedgedReset: false,
          error: null,
        };
        return;
      }
    }
    this.running = true;
    this.sweepStartedAt = Date.now();

    let scannedCount = 0;
    let reapedOrdersCount = 0;
    let reapedOrderNumbers: string[] = [];
    let error: string | null = null;
    try {
      const result = await this.storefrontService.reapExpiredReservations({ limit: 50 });
      scannedCount = result.scannedCount;
      reapedOrdersCount = result.reapedOrdersCount;
      reapedOrderNumbers = result.reapedOrderNumbers;
      // D-SF-12: log EVERY sweep, including zero counts — an empty sweep
      // logging nothing is what let a dead reaper pass as "nothing expired".
      this.logger.log(
        `Automated reservation reaper sweep: scanned ${scannedCount}, reaped ${reapedOrdersCount}` +
          (reapedOrdersCount > 0 ? ` (${reapedOrderNumbers.join(', ')})` : ''),
      );
    } catch (err) {
      error = (err as Error)?.message || String(err);
      this.logger.error(`Automated reservation reaper encountered an error: ${error}`);
    } finally {
      this.running = false;
      this.sweepStartedAt = undefined;
      StorefrontReservationSchedulerService._lastResults = {
        type: 'storefront_reservation_sweep',
        completedAt: new Date().toISOString(),
        scannedCount,
        reapedOrdersCount,
        reapedOrderNumbers,
        skippedWhileRunning: false,
        wedgedReset,
        error,
      };
    }
  }
}

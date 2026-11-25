import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { SettingsSupportService } from './settings-support.service';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';

interface DiagnosticsQueueMeta {
  lastGeneratedPeriod?: string;
  status?: 'PENDING_UPLOAD' | 'UPLOADED';
  createdAt?: string;
  uploadedAt?: string;
  lastAttemptAt?: string;
}

@Injectable()
export class DiagnosticsSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DiagnosticsSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(private readonly supportService: SettingsSupportService) {}

  onApplicationBootstrap() {
    // Only activate in desktop / local / portable modes, not on the central SaaS production server
    const appMode = process.env.APP_MODE;
    const isSaaS = appMode === 'CLOUD_SAAS';
    if (isSaaS) {
      return;
    }

    this.logger.log('Starting automated monthly diagnostics scheduler (Scheduled day: 15th of every month)...');

    // Run first check 15 seconds after app startup (after database & services are warmed up)
    setTimeout(() => {
      this.checkAndProcessDiagnostics().catch((err) => {
        this.logger.warn(`Initial diagnostics check failed: ${err?.message}`);
      });
    }, 15000);

    // Then check every 30 minutes
    this.timer = setInterval(
      () => {
        this.checkAndProcessDiagnostics().catch((err) => {
          this.logger.warn(`Routine diagnostics check failed: ${err?.message}`);
        });
      },
      30 * 60 * 1000,
    );
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private getQueuePaths() {
    const queueDir = path.join(process.cwd(), 'storage', 'diagnostics_pending');
    const metaPath = path.join(queueDir, 'queue_meta.json');
    return { queueDir, metaPath };
  }

  private async readMeta(): Promise<DiagnosticsQueueMeta> {
    const { metaPath } = this.getQueuePaths();
    try {
      if (fsSync.existsSync(metaPath)) {
        const text = await fs.readFile(metaPath, 'utf8');
        return JSON.parse(text);
      }
    } catch {
      // ignore
    }
    return {};
  }

  private async saveMeta(meta: DiagnosticsQueueMeta): Promise<void> {
    const { queueDir, metaPath } = this.getQueuePaths();
    try {
      await fs.mkdir(queueDir, { recursive: true });
      await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
    } catch (err) {
      this.logger.warn(`Failed to save diagnostics queue meta: ${err}`);
    }
  }

  /**
   * Main check & process cycle:
   * 1. Checks if it's the 15th of the month or later and creates pending zip locally (offline or online).
   * 2. Checks if there is a pending zip and uploads it as soon as an internet connection is reachable ("أول ما يشم نت").
   */
  async checkAndProcessDiagnostics(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const now = new Date();
      const currentDay = now.getDate();
      const pad = (n: number) => String(n).padStart(2, '0');
      const currentPeriod = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
      const scheduledDay = parseInt(process.env.DIAGNOSTICS_SCHEDULE_DAY || '15', 10);

      const { queueDir } = this.getQueuePaths();
      await fs.mkdir(queueDir, { recursive: true });

      let meta = await this.readMeta();

      // ─── Step 1: Generate monthly bundle if scheduled day reached and not yet generated ───
      if (currentDay >= scheduledDay && meta.lastGeneratedPeriod !== currentPeriod) {
        this.logger.log(
          `[DiagnosticsScheduler] Day ${currentDay} reached. Creating monthly diagnostic bundle for period ${currentPeriod}...`,
        );

        try {
          const zipBuffer = await this.supportService.generateSupportBundleInternal();
          const zipFilePath = path.join(queueDir, `pending_${currentPeriod}.zip`);
          await fs.writeFile(zipFilePath, zipBuffer);

          meta = {
            lastGeneratedPeriod: currentPeriod,
            status: 'PENDING_UPLOAD',
            createdAt: now.toISOString(),
          };
          await this.saveMeta(meta);

          this.logger.log(
            `[DiagnosticsScheduler] Diagnostic bundle for ${currentPeriod} generated and stored locally in ${zipFilePath}.`,
          );
        } catch (err: any) {
          this.logger.error(`[DiagnosticsScheduler] Failed to generate local diagnostic bundle: ${err?.message}`);
        }
      }

      // ─── Step 2: If there is a pending bundle, attempt upload ("أول ما يشم نت") ───
      if (meta.status === 'PENDING_UPLOAD' && meta.lastGeneratedPeriod) {
        const pendingZipPath = path.join(queueDir, `pending_${meta.lastGeneratedPeriod}.zip`);

        if (fsSync.existsSync(pendingZipPath)) {
          // Check internet connectivity
          const isOnline = await this.checkConnectivity();
          if (isOnline) {
            this.logger.log(
              `[DiagnosticsScheduler] Internet connection detected! Uploading pending diagnostics for period ${meta.lastGeneratedPeriod} to SaaS...`,
            );

            try {
              const fileBuffer = await fs.readFile(pendingZipPath);
              await this.supportService.uploadSupportBundleToServer(undefined, fileBuffer);

              // Upload succeeded: clean up local zip to save disk space
              await fs.unlink(pendingZipPath).catch(() => undefined);

              meta.status = 'UPLOADED';
              meta.uploadedAt = new Date().toISOString();
              await this.saveMeta(meta);

              this.logger.log(
                `[DiagnosticsScheduler] Successfully uploaded diagnostics for ${meta.lastGeneratedPeriod} to central SaaS server.`,
              );
            } catch (err: any) {
              meta.lastAttemptAt = new Date().toISOString();
              await this.saveMeta(meta);
              this.logger.debug(`[DiagnosticsScheduler] Upload attempt postponed: ${err?.message}`);
            }
          }
        } else {
          // File was deleted or missing, reset status
          meta.status = 'UPLOADED';
          await this.saveMeta(meta);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Fast, non-blocking check to verify if the machine can reach the internet
   */
  private async checkConnectivity(): Promise<boolean> {
    const centralUrl =
      process.env.CENTRAL_DIAGNOSTICS_URL || 'https://app.zsystemai.com/api/v1/saas-admin/diagnostics/upload';

    try {
      // 1. First probe central endpoint or ping with HEAD
      const res = await fetch(centralUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(4000),
      }).catch(() => null);

      if (res && res.status < 500) {
        return true;
      }

      // 2. Fallback check: Google DNS or Cloudflare
      const ping = await fetch('https://1.1.1.1', {
        method: 'HEAD',
        signal: AbortSignal.timeout(3000),
      }).catch(() => null);

      return !!ping;
    } catch {
      return false;
    }
  }
}

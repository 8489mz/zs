/// <reference types="multer" />
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { type Kysely } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import type { Database } from '../../../database/database.types';
import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
export { generateReleasePasscode, assertTrustedOfflineUpdatePackage } from './offline-releases/offline-releases-passcode';
export { OFFLINE_UPDATE_REPO_DEFAULT, offlineUpdateRepo, offlineUpdateManifestUrl, offlineUpdateReleasesApiUrl, offlineUpdateReleaseDownloadUrl } from './offline-releases/offline-releases-channel';
export { compareSemver } from './offline-releases/offline-releases-semver';
import { OfflineReleasesInitSync } from './offline-releases/offline-releases-init-sync';
import { OfflineReleasesGitHub } from './offline-releases/offline-releases-github';
import { OfflineReleasesCheck } from './offline-releases/offline-releases-check';
import { OfflineReleasesSimulate } from './offline-releases/offline-releases-simulate';
import { OfflineReleasesAdmin } from './offline-releases/offline-releases-admin';
import { OfflineReleasesApply } from './offline-releases/offline-releases-apply';
import { OfflineReleasesZipVersion } from './offline-releases/offline-releases-zip-version';

@Injectable()
export class OfflineReleasesService implements OnModuleInit {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {
    this.s1 = new OfflineReleasesInitSync(this.db);
    this.s2 = new OfflineReleasesGitHub();
    this.s3 = new OfflineReleasesCheck(this.db, {
      syncManifestsFromDisk: () => this.s1.syncManifestsFromDisk(),
      fetchGitHubLatestRelease: () => this.s2.fetchGitHubLatestRelease(),
    });
    this.s4 = new OfflineReleasesSimulate(this.db);
    this.s5 = new OfflineReleasesAdmin(this.db);
    this.s6 = new OfflineReleasesApply(this.db);
    this.s7 = new OfflineReleasesZipVersion();
  }

  private readonly s1: OfflineReleasesInitSync;
  private readonly s2: OfflineReleasesGitHub;
  private readonly s3: OfflineReleasesCheck;
  private readonly s4: OfflineReleasesSimulate;
  private readonly s5: OfflineReleasesAdmin;
  private readonly s6: OfflineReleasesApply;
  private readonly s7: OfflineReleasesZipVersion;

  async onModuleInit() {
    return this.s1.onModuleInit();
  }

  async fetchGitHubLatestRelease(): Promise<{ version: string; changelog: string; patchUrl: string; passcode?: string; } | null> {
    return this.s2.fetchGitHubLatestRelease();
  }

  async checkForUpdate(currentVersion: string) {
    return this.s3.checkForUpdate(currentVersion);
  }
  async listReleaseHistory() {
    return this.s3.listReleaseHistory();
  }

  async simulateUpdate(body: { fromVersion?: string; targetVersion?: string; passcode?: string }) {
    return this.s4.simulateUpdate(body);
  }

  async listReleases(_auth: AuthContext) {
    return this.s5.listReleases(_auth);
  }
  async getReleasePasscode(_auth: AuthContext, id: number) {
    return this.s5.getReleasePasscode(_auth, id);
  }
  async setReleasePasscode(_auth: AuthContext, id: number, passcode: string) {
    return this.s5.setReleasePasscode(_auth, id, passcode);
  }
  async getReleasePasscodeByVersion(_auth: AuthContext, version: string) {
    return this.s5.getReleasePasscodeByVersion(_auth, version);
  }
  async createRelease(_auth: AuthContext, body: { version: string; changelog: string; patchUrl: string; passcode?: string; requiresPasscode?: boolean }) {
    return this.s5.createRelease(_auth, body);
  }
  async promoteRelease(auth: AuthContext, id: number) {
    return this.s5.promoteRelease(auth, id);
  }
  async deactivateRelease(_auth: AuthContext, id: number) {
    return this.s5.deactivateRelease(_auth, id);
  }

  async triggerUpdate(auth: AuthContext) {
    return this.s6.triggerUpdate(auth);
  }
  async applyLocalUpdate(body: { version: string; patchUrl: string; changelog: string; passcode?: string }) {
    return this.s6.applyLocalUpdate(body);
  }

  async applyLocalZipUpdate(file: Express.Multer.File, passcode?: string) {
    return this.s7.applyLocalZipUpdate(file, passcode);
  }
  getCurrentVersion(): { version: string } {
    return this.s7.getCurrentVersion();
  }
}

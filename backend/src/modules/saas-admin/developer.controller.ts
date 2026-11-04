import { Body, Controller, Post, Get, Headers, Req, UnauthorizedException, ForbiddenException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { SaasAdminService } from './saas-admin.service';
import { DeveloperUpdatePlanDto, SetDeveloperMasterPasswordDto } from './dto/developer-update-plan.dto';
import { isDesktopRuntimeMode } from '../../config/app-mode';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { SuperAdminRoleGuard } from '../../core/auth/guards/super-admin-role.guard';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { assertStrongPassword } from '../../core/auth/utils/password-policy';
import { createPasswordRecord, verifyPassword } from '../../core/auth/utils/password-hasher';

// The developer master password is a SEPARATE secret from any login
// password (INV-DEVELOPER-MASTER-PASSWORD). It is set or changed only
// by the super_admin through POST /api/developer/master-password, which
// stores a bcrypt hash; the fixed desktop fallback password was removed
// by owner decision (2026-11-04) and must never return. Until a hash
// exists, the DEVELOPER_MASTER_PASSWORD environment value is accepted
// as a transition; once a hash is set, the env value alone never
// authenticates. Runtime isolation is enforced before checking any
// password.

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

@Controller('api/developer')
export class DeveloperController {
  constructor(
    private readonly saasAdminService: SaasAdminService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * These endpoints grant any plan and any feature set to any tenant, so they exist only
   * for the offline/desktop build. The check is an allow-list, not a CLOUD_SAAS deny-list:
   * an unreadable or unexpected mode must disable the panel, never enable it (F12).
   * Uses the same runtime policy as portal tokens and local update/transfer endpoints.
   */
  private assertDeveloperAccessAllowed(): void {
    const appMode = String(
      this.configService.get<string>('APP_MODE') || this.configService.get<string>('app.mode') || '',
    )
      .trim()
      .toUpperCase();

    if (!isDesktopRuntimeMode(appMode)) {
      throw new ForbiddenException('Developer endpoints are only available in the offline desktop build');
    }
  }

  /**
   * An unset DEVELOPER_MASTER_PASSWORD disables the panel. The env value
   * is the transition fallback only: once a super_admin-set hash exists,
   * updatePlan verifies against the hash and never reaches this value.
   * The env floor is unchanged (1) so existing operator setups keep
   * working until a hash is set; the hash path enforces 12 (see
   * setMasterPassword). Cloud never reaches password verification.
   */
  private resolveMasterPassword(): string {
    const configured = String(
      this.configService.get<string>('DEVELOPER_MASTER_PASSWORD') || process.env.DEVELOPER_MASTER_PASSWORD || '',
    ).trim();

    if (configured.length < 1) {
      throw new ForbiddenException(
        'لوحة المطورين معطّلة: DEVELOPER_MASTER_PASSWORD غير مضبوط أو أقصر من الحد الأدنى على هذا الخادم.',
      );
    }

    return configured;
  }

  @Get('feature-plans')
  async listFeaturePlans() {
    this.assertDeveloperAccessAllowed();
    return this.saasAdminService.developerListFeaturePlans();
  }

  @Post('update-plan')
  async updatePlan(@Body() body: DeveloperUpdatePlanDto) {
    this.assertDeveloperAccessAllowed();
    const candidate = String(body.masterPassword || '').trim();
    if (!candidate) {
      throw new UnauthorizedException('Invalid master password');
    }
    // A super_admin-set hash, when present, is the ONLY accepted
    // secret: the env fallback must not bypass a rotated password.
    const storedHash = await this.saasAdminService.getDeveloperMasterPasswordHash();
    const isMatch = storedHash
      ? (await verifyPassword(candidate, storedHash, '')).valid
      : safeCompare(candidate, this.resolveMasterPassword());
    if (!isMatch) {
      throw new UnauthorizedException('Invalid master password');
    }
    return this.saasAdminService.developerUpdateTenantPlan(body);
  }

  /**
   * The ONE place the developer master password can be set or changed:
   * desktop mode only, authenticated platform super_admin only, and
   * never the super_admin login password. Stores a bcrypt hash; the
   * plaintext candidate never reaches storage or logs.
   */
  @Post('master-password')
  @UseGuards(SessionAuthGuard, SuperAdminRoleGuard)
  async setMasterPassword(@Body() body: SetDeveloperMasterPasswordDto, @Req() req: RequestWithAuth) {
    this.assertDeveloperAccessAllowed();
    assertStrongPassword(body.newMasterPassword, { role: 'super_admin' });
    const record = await createPasswordRecord(body.newMasterPassword);
    await this.saasAdminService.setDeveloperMasterPasswordHash(record.hash, req.authContext!);
    return { ok: true };
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { SessionService, isMfaChallenge, type AuthenticatedSessionResult } from '../../core/auth/services/session.service';
import { AuditService } from '../../core/audit/audit.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { ConfirmPasswordResetDto, RequestPasswordResetDto, ValidatePasswordResetTokenDto } from './dto/password-reset.dto';
import { PasswordResetService } from './password-reset.service';
import { MfaService } from './mfa.service';
import { DisableMfaDto, MfaCodeDto, MfaLoginDto } from './dto/mfa.dto';
import { resolveClientIp } from '../../common/middleware/storefront-public-rate-limit.middleware';
import { createCsrfToken } from '../../core/auth/utils/csrf-token';
import { isLocalAuthCookieHost, clearKnownAuthCookies } from '../../core/auth/utils/auth-cookie-cleanup';
import { ActivationService } from '../activation/activation.service';

@Controller('api/auth')
export class SessionsController {
  constructor(
    private readonly sessionService: SessionService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
    private readonly activationService: ActivationService,
    private readonly passwordResetService: PasswordResetService,
    private readonly mfaService: MfaService,
  ) {}

  /**
   * عنوان العميل الحقيقي خلف nginx/Cloudflare. `req.ip` وحده هو عنوان البروكسي، فكان كل
   * الزوار يقعون في دلو واحد لحدود المحاولات (O69). نفس الدالة التي تستعملها حدود المتجر.
   */
  private clientIp(req: RequestWithAuth): string {
    return resolveClientIp(req.ip || req.socket?.remoteAddress, req.headers['x-real-ip']);
  }

  /** أصل الطلب كما وصل عبر البروكسي — يُستخدم كبديل حين لا يُضبط `APP_PUBLIC_URL`. */
  private requestOrigin(req: RequestWithAuth): string | undefined {
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'https';
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    return host ? `${proto}://${host}` : undefined;
  }

  private sharedCookieDomain(req?: RequestWithAuth): string | undefined {
    if (req) {
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      if (isLocalAuthCookieHost(this.configService.get('APP_MODE') || process.env.APP_MODE, host)) {
        return undefined;
      }
    }
    const domain = this.configService.get<string>('SESSION_COOKIE_DOMAIN')?.trim();
    return domain || undefined;
  }

  private cookieOptions(expiresAt?: Date, req?: RequestWithAuth) {
    const isLoopback = isLocalAuthCookieHost(
      this.configService.get('APP_MODE') || process.env.APP_MODE,
      req?.headers['x-forwarded-host'] || req?.headers.host,
    );
    const domain = isLoopback ? undefined : this.sharedCookieDomain(req);
    const secure = isLoopback ? false : this.configService.get<boolean>('SESSION_COOKIE_SECURE') === true;

    return {
      httpOnly: true,
      sameSite: this.configService.get<'lax' | 'strict' | 'none'>('SESSION_COOKIE_SAME_SITE') ?? 'lax',
      secure,
      expires: expiresAt,
      path: '/',
      ...(domain ? { domain } : {}),
    };
  }

  private csrfCookieOptions(expiresAt?: Date, req?: RequestWithAuth) {
    const isLoopback = isLocalAuthCookieHost(
      this.configService.get('APP_MODE') || process.env.APP_MODE,
      req?.headers['x-forwarded-host'] || req?.headers.host,
    );
    const domain = isLoopback ? undefined : this.sharedCookieDomain(req);
    const secure = isLoopback ? false : this.configService.get<boolean>('SESSION_COOKIE_SECURE') === true;

    return {
      httpOnly: false,
      sameSite: this.configService.get<'lax' | 'strict' | 'none'>('SESSION_COOKIE_SAME_SITE') ?? 'lax',
      secure,
      expires: expiresAt,
      path: '/',
      ...(domain ? { domain } : {}),
    };
  }

  private getSessionCookieName(): string {
    return this.configService.get<string>('SESSION_COOKIE_NAME')?.trim() || 'session_id';
  }

  private getCsrfCookieName(): string {
    return this.configService.get<string>('SESSION_CSRF_COOKIE_NAME')?.trim() || 'csrf_token';
  }

  private allowLocalSessionHeaderFallback(): boolean {
    if (String(this.configService.get('ALLOW_SESSION_ID_HEADER')).toLowerCase() === 'false') return false;
    return true;
  }

  private setAuthCookies(res: Response, sessionId: string, expiresAt: Date, req?: RequestWithAuth): void {
    const csrfSecret = this.configService.get<string>('SESSION_CSRF_SECRET') || '';
    const csrfToken = createCsrfToken(sessionId, csrfSecret);
    res.cookie(this.getSessionCookieName(), sessionId, this.cookieOptions(expiresAt, req));
    res.cookie(this.getCsrfCookieName(), csrfToken, this.csrfCookieOptions(expiresAt, req));
  }

  private clearAuthCookies(res: Response, req?: RequestWithAuth): void {
    const isLoopback = isLocalAuthCookieHost(
      this.configService.get('APP_MODE') || process.env.APP_MODE,
      req?.headers['x-forwarded-host'] || req?.headers.host,
    );
    clearKnownAuthCookies(res, {
      sessionCookieName: this.getSessionCookieName(),
      csrfCookieName: this.getCsrfCookieName(),
      sameSite: this.configService.get<'lax' | 'strict' | 'none'>('SESSION_COOKIE_SAME_SITE') ?? 'lax',
      secure: isLoopback ? false : this.configService.get<boolean>('SESSION_COOKIE_SECURE') === true,
      domain: isLoopback ? undefined : this.sharedCookieDomain(req),
    });
  }

  @Post('login')
  async login(
    @Body() payload: LoginDto,
    @Req() req: RequestWithAuth,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Record<string, unknown>> {
    await this.activationService.assertLoginAllowed();

    const username = String(payload?.username || '').trim();
    const password = String(payload?.password || '');

    if (!username || !password) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const result = await this.sessionService.authenticate(username, password, {
      ipAddress: req.ip,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : '',
      companyCode: payload.companyCode || (typeof req.headers['x-tenant-id'] === 'string' ? req.headers['x-tenant-id'] : undefined),
    });

    if (!result) {
      throw new UnauthorizedException('Invalid username or password');
    }

    // MFA-1: كلمة المرور وحدها لم تُنشئ جلسة لهذا الحساب — لا كوكي ولا صف في `sessions`.
    if (isMfaChallenge(result)) {
      return { ok: true, mfaRequired: true, mfaToken: result.mfaToken, username: result.username };
    }

    return this.finishLogin(result, req, res);
  }

  /** الخطوة الثانية لمن فعّل المصادقة الثنائية: التحدي + رمز التطبيق (أو رمز استرداد). */
  @Post('login/mfa')
  async loginMfa(
    @Body() payload: MfaLoginDto,
    @Req() req: RequestWithAuth,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Record<string, unknown>> {
    await this.activationService.assertLoginAllowed();

    const result = await this.sessionService.completeMfaLogin(payload.mfaToken, payload.code, {
      ipAddress: req.ip,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : '',
    });

    return this.finishLogin(result, req, res);
  }

  /** النصف المشترك بين الدخول العادي والدخول بعد العامل الثاني: الكوكي والتدقيق والحمولة. */
  private async finishLogin(
    result: AuthenticatedSessionResult,
    req: RequestWithAuth,
    res: Response,
  ): Promise<Record<string, unknown>> {
    this.setAuthCookies(res, result.sessionId, result.expiresAt, req);

    await this.auditService.log('تسجيل دخول', `تم تسجيل دخول المستخدم ${result.auth.username}`, result.auth);

    return {
      ok: true,
      ...(await this.sessionService.buildLoginPayload(result.auth)),
      sessionId: result.sessionId,
      expiresAt: result.expiresAt.toISOString(),
    };
  }

  /** إعداد المصادقة الثنائية — محروس بالجلسة: المستخدم يعدّل عامله الثاني وحده. */
  @Get('mfa/status')
  @UseGuards(SessionAuthGuard)
  async mfaStatus(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.mfaService.getStatus(req.authContext!);
  }

  @Post('mfa/setup')
  @UseGuards(SessionAuthGuard)
  async mfaSetup(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.mfaService.beginSetup(req.authContext!);
  }

  @Post('mfa/confirm')
  @UseGuards(SessionAuthGuard)
  async mfaConfirm(@Body() payload: MfaCodeDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.mfaService.confirmSetup(req.authContext!, payload.code);
  }

  @Post('mfa/disable')
  @UseGuards(SessionAuthGuard)
  async mfaDisable(@Body() payload: DisableMfaDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.mfaService.disable(req.authContext!, payload.currentPassword, payload.code);
  }

  @Post('mfa/recovery-codes')
  @UseGuards(SessionAuthGuard)
  async mfaRegenerateRecoveryCodes(@Body() payload: MfaCodeDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.mfaService.regenerateRecoveryCodes(req.authContext!, payload.code);
  }

  /**
   * استعادة كلمة المرور — ثلاثة مسارات **عامة** عمداً: من نسي كلمته لا يملك جلسة.
   * الحماية هنا ليست حارساً بل: حدّ محاولات لكل IP ولكل بريد، ورد ثابت لا يكشف وجود الحساب،
   * ورمز ذو حالة يُستهلك مرة واحدة (`password-reset-token.ts`).
   */
  @Post('password-reset/request')
  async requestPasswordReset(@Body() payload: RequestPasswordResetDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.passwordResetService.requestReset(payload, {
      ip: this.clientIp(req),
      origin: this.requestOrigin(req),
    });
  }

  @Post('password-reset/validate')
  async validatePasswordResetToken(@Body() payload: ValidatePasswordResetTokenDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.passwordResetService.validateToken(payload, { ip: this.clientIp(req) });
  }

  @Post('password-reset/confirm')
  async confirmPasswordReset(@Body() payload: ConfirmPasswordResetDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.passwordResetService.confirmReset(payload, { ip: this.clientIp(req) });
  }

  @Post('logout')
  async logout(
    @Req() req: RequestWithAuth,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Record<string, unknown>> {
    const cookieHeader = typeof req.headers.cookie === 'string' ? req.headers.cookie : '';
    const sessionCookieName = this.getSessionCookieName();
    const sessionFromCookie = cookieHeader
      .split(';')
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(`${sessionCookieName}=`))
      ?.slice(sessionCookieName.length + 1)
      .trim();
    const sessionFromHeader = typeof req.headers['x-session-id'] === 'string' ? req.headers['x-session-id'].trim() : '';
    const sessionId = String(req.authContext?.sessionId || sessionFromCookie || sessionFromHeader || '').trim();

    if (sessionId) {
      await this.sessionService.logout(sessionId, req.authContext);
    }

    this.clearAuthCookies(res, req);

    if (req.authContext) {
      await this.auditService.log('تسجيل خروج', `تم تسجيل خروج المستخدم ${req.authContext.username}`, req.authContext);
    }

    return { ok: true };
  }

  @Get('sessions')
  @UseGuards(SessionAuthGuard)
  async list(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    const sessions = await this.sessionService.listSessions(req.authContext!);
    return { sessions };
  }

  @Delete('sessions/:id')
  @UseGuards(SessionAuthGuard)
  async revoke(@Param('id') sessionId: string, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    const removed = await this.sessionService.revokeSessionForUser(sessionId, req.authContext!);
    if (!removed) {
      throw new NotFoundException('Session not found');
    }

    const sessions = await this.sessionService.listSessions(req.authContext!);
    await this.auditService.log('إنهاء جلسة', `تم إنهاء جلسة للمستخدم ${req.authContext!.username}`, req.authContext!);
    return { ok: true, sessions };
  }

  @Post('sessions/revoke-others')
  @UseGuards(SessionAuthGuard)
  async revokeOthers(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    const removed = await this.sessionService.revokeOtherSessions(req.authContext!, req.authContext!.sessionId);
    const sessions = await this.sessionService.listSessions(req.authContext!);
    await this.auditService.log('إنهاء الجلسات الأخرى', `تم إنهاء ${removed} جلسة أخرى`, req.authContext!);
    return { ok: true, removed, sessions };
  }

  @Post('change-password')
  @UseGuards(SessionAuthGuard)
  async changePassword(@Body() payload: ChangePasswordDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    await this.sessionService.changePassword(req.authContext!, payload.currentPassword, payload.newPassword);
    const removed = await this.sessionService.revokeOtherSessions(req.authContext!, req.authContext!.sessionId);
    await this.auditService.log('تغيير كلمة المرور', `تم تغيير كلمة المرور وإنهاء ${removed} جلسة`, req.authContext!);
    return { ok: true, removedOtherSessions: removed };
  }

  @Post('dismiss-password-change')
  @UseGuards(SessionAuthGuard)
  async dismissPasswordChange(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    if (req.authContext) {
      await this.sessionService.dismissPasswordChange(req.authContext);
      await this.auditService.log('تخطي تغيير كلمة المرور', `المستخدم ${req.authContext.username} اختار المتابعة بكلمة المرور الحالية`, req.authContext);
    }
    return { ok: true };
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  me(
    @Req() req: RequestWithAuth,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Record<string, unknown>> {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    this.setAuthCookies(res, req.authContext!.sessionId, expiresAt);
    return this.sessionService.buildMePayload(req.authContext!);
  }
}

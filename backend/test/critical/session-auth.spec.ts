import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { SessionService, isMfaChallenge, type AuthenticatedSessionResult } from '../../src/core/auth/services/session.service';
import type { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

/**
 * كل نداء `authenticate` في هذا الجناح يخص حساباً بلا مصادقة ثنائية، فالنتيجة يجب أن تكون
 * جلسة جاهزة لا تحدياً. هذا يضيّق النوع **ويحرس في الوقت نفسه**: لو عاد مسار الدخول يوماً
 * يطلب عاملاً ثانياً من حساب لم يفعّله، يفشل الجناح هنا بدل أن يمر بصمت.
 */
function expectSession(
  result: Awaited<ReturnType<SessionService['authenticate']>>,
): AuthenticatedSessionResult {
  assert.ok(result, 'expected a successful login');
  assert.ok(!isMfaChallenge(result), 'an account without MFA must get a session, not a challenge');
  return result as AuthenticatedSessionResult;
}


function hashPassword(password: string, salt: string): string {
  return createHash('sha256').update(`${password}:${salt}`).digest('hex');
}

type UserRow = {
  id: number;
  username: string;
  phone?: string | null;
  display_name?: string;
  default_branch_id?: number | null;
  password_hash: string;
  password_salt: string;
  role: string;
  permissions_json: string;
  is_active: boolean;
  locked_until: Date | null;
  failed_login_count: number;
  must_change_password?: boolean;
  last_login_at?: Date | null;
  tenant_id?: string | null;
  account_id?: string | null;
};

type SessionRow = {
  id: string;
  user_id: number;
  tenant_id?: string;
  account_id?: string;
  expires_at: Date;
  last_seen_at: Date;
  ip_address: string;
  user_agent: string;
  created_at?: Date;
};

type SettingRow = { key: string; value: string; tenant_id?: string };
type UserBranchRow = { user_id: number; branch_id: number; tenant_id?: string };

class FakeConfigService {
  constructor(private readonly values: Record<string, unknown>) {}
  get<T>(key: string): T | undefined {
    return this.values[key] as T | undefined;
  }
}

class FakeDb {
  public tenants: Array<{ id: string; slug: string; business_name: string; status: string; trial_ends_at: Date | null; created_at: Date }> = [];
  public userMfa: Array<{ user_id: number; tenant_id: string; confirmed_at: Date | null }> = [];
  constructor(
    public users: UserRow[],
    public sessions: SessionRow[] = [],
    public settings: SettingRow[] = [],
    public userBranches: UserBranchRow[] = [],
  ) {}

  // Password changes update the password record and revoke other sessions atomically.
  // Model that transaction boundary in the fake DB instead of removing the production
  // transaction to satisfy a test double.
  transaction() {
    return { execute: async <T>(callback: (trx: FakeDb) => Promise<T>): Promise<T> => callback(this) };
  }

  selectFrom(table: string) {
    if (table === 'users') return new UsersSelectBuilder(this);
    if (table === 'settings') return new SettingsSelectBuilder(this);
    if (table === 'user_branches') return new UserBranchesSelectBuilder(this);
    if (table === 'tenants') return new TenantsSelectBuilder(this);
    if (table === 'user_mfa') return new UserMfaSelectBuilder(this);
    if (table === 'tenant_tax_settings') {
      return {
        select: () => ({
          where: () => ({
            where: () => ({
              executeTakeFirst: () => Promise.resolve(null),
            }),
            executeTakeFirst: () => Promise.resolve(null),
          }),
          executeTakeFirst: () => Promise.resolve(null),
        }),
      };
    }
    throw new Error(`Unsupported select table: ${table}`);
  }

  insertInto(table: string) {
    if (table === 'sessions') return new SessionsInsertBuilder(this);
    throw new Error(`Unsupported insert table: ${table}`);
  }

  updateTable(table: string) {
    if (table === 'users') return new UsersUpdateBuilder(this);
    if (table === 'tenants') return new TenantsUpdateBuilder(this);
    throw new Error(`Unsupported update table: ${table}`);
  }

  deleteFrom(table: string) {
    if (table === 'sessions') return new SessionsDeleteBuilder(this);
    throw new Error(`Unsupported delete table: ${table}`);
  }
}

class UsersSelectBuilder {
  private username?: string;
  private phone?: string;
  private phones?: string[];
  private tenantId?: string;
  private id?: number;
  constructor(private readonly db: FakeDb) {}
  select(_cols: string[]) { return this; }
  // Source code locks users during failed-login accounting and session creation.
  // This in-memory fixture exercises the query chain only, not real PG concurrency.
  forUpdate() { return this; }
  where(column: string | unknown, _op?: string, value?: any) {
    if (column === 'username') this.username = String(value);
    if (column === 'phone') {
      if (_op === 'in' && Array.isArray(value)) {
        this.phones = value.map((v) => String(v));
      } else {
        this.phone = String(value);
      }
    }
    if (column === 'tenant_id') this.tenantId = String(value);
    if (column === 'id') this.id = Number(value);
    if (typeof column === 'object' && column !== null) {
      const node = (column as any)?.toOperationNode?.() || (column as any);
      const sqlFragments = node?.sqlFragments || [];
      const parameters = node?.parameters || [];
      const text = Array.isArray(sqlFragments) ? sqlFragments.join(' ') : '';
      const values = Array.isArray(parameters) ? parameters.map((p: any) => (p?.value != null ? p.value : p)) : [];

      if (text.includes('phone') && values.length > 0) {
        this.phone = String(values[0]);
      } else if (text.toLowerCase().includes('username') && values.length > 0) {
        this.username = String(values[0]);
      }
    }
    return this;
  }
  async execute() {
    let rows = this.db.users;
    if (this.tenantId != null) {
      rows = rows.filter((r) => r.tenant_id === this.tenantId);
    }
    if (this.phones != null && this.phones.length > 0) {
      rows = rows.filter((r) => r.phone != null && this.phones!.includes(r.phone));
    } else if (this.phone != null) {
      rows = rows.filter((r) => r.phone === this.phone);
    } else if (this.username != null) {
      rows = rows.filter((row) => row.username.toLowerCase() === this.username!.toLowerCase());
    } else if (this.id != null) {
      rows = rows.filter((row) => row.id === this.id);
    }
    return rows;
  }
  async executeTakeFirst() {
    const list = await this.execute();
    return list[0] ?? undefined;
  }
}

class TenantsSelectBuilder {
  private id?: string;
  private ids?: string[];
  constructor(private readonly db: FakeDb) {}
  select(_cols: string[]) { return this; }
  where(column: string, op: string, value: any) {
    if (column === 'id') {
      if (op === 'in' && Array.isArray(value)) {
        this.ids = value;
      } else {
        this.id = value;
      }
    }
    return this;
  }
  async execute() {
    if (this.ids) {
      return this.db.tenants.filter((row) => this.ids?.includes(row.id));
    }
    return this.id ? this.db.tenants.filter((row) => row.id === this.id) : this.db.tenants;
  }
  async executeTakeFirst() {
    return this.db.tenants.find((row) => row.id === this.id) ?? undefined;
  }
}

class UserMfaSelectBuilder {
  private userId?: number;
  private tenantId?: string;
  private confirmedOnly = false;
  constructor(private readonly db: FakeDb) {}
  select(_cols: string[]) { return this; }
  where(column: string, op: string, value: any) {
    if (column === 'user_id') this.userId = value;
    if (column === 'tenant_id') this.tenantId = value;
    if (column === 'confirmed_at' && op === 'is not') this.confirmedOnly = true;
    return this;
  }
  async executeTakeFirst() {
    return this.db.userMfa.find((row) => (
      row.user_id === this.userId
      && (this.tenantId === undefined || row.tenant_id === this.tenantId)
      && (!this.confirmedOnly || row.confirmed_at !== null)
    )) ?? undefined;
  }
}

class SettingsSelectBuilder {
  constructor(private readonly db: FakeDb) {}
  select(_cols: string[]) { return this; }
  where(_column: string | unknown, _op?: string, _value?: unknown) { return this; }
  async execute() { return this.db.settings; }
}

class UserBranchesSelectBuilder {
  private userId?: number;
  constructor(private readonly db: FakeDb) {}
  select(_cols: string[]) { return this; }
  where(column: string | unknown, _op?: string, value?: number) {
    if (column === 'user_id') this.userId = Number(value);
    return this;
  }
  async execute() {
    return this.db.userBranches.filter((row) => this.userId == null || row.user_id === this.userId);
  }
}

class SessionsInsertBuilder {
  private payload!: SessionRow;
  constructor(private readonly db: FakeDb) {}
  values(payload: SessionRow) { this.payload = payload; return this; }
  async execute() {
    this.db.sessions.push({ ...this.payload, created_at: new Date() });
  }
}

class UsersUpdateBuilder {
  private payload: Partial<UserRow> = {};
  private id!: number;
  constructor(private readonly db: FakeDb) {}
  set(payload: Partial<UserRow>) { this.payload = payload; return this; }
  where(column: string | unknown, _op?: string, value?: number) {
    if (column === 'id') this.id = Number(value);
    return this;
  }
  async execute() {
    const row = this.db.users.find((item) => item.id === this.id);
    if (!row) return;
    Object.assign(row, this.payload);
  }
}

class TenantsUpdateBuilder {
  constructor(private readonly _db: FakeDb) {}
  set(_payload: Record<string, unknown>) { return this; }
  where(_column: string, _op: string, _value: string) { return this; }
  async execute() {}
}

class SessionsDeleteBuilder {
  private userId?: number;
  private sessionId?: string;
  private notSessionId?: string;
  constructor(private readonly db: FakeDb) {}
  where(column: string | unknown, op?: string, value?: string | number) {
    if (column === 'user_id') this.userId = Number(value);
    if (column === 'id' && op === '=') this.sessionId = String(value);
    if (column === 'id' && op === '!=') this.notSessionId = String(value);
    return this;
  }
  async executeTakeFirst() {
    const before = this.db.sessions.length;
    this.db.sessions = this.db.sessions.filter((row) => {
      if (this.userId != null && row.user_id !== this.userId) return true;
      if (this.sessionId != null && row.id !== this.sessionId) return true;
      if (this.notSessionId != null && row.id === this.notSessionId) return true;
      return false;
    });
    return { numDeletedRows: BigInt(before - this.db.sessions.length) };
  }
  async execute() {
    await this.executeTakeFirst();
  }
}

async function run(): Promise<void> {
  const salt = 'salt-1';
  const password = 'AdminStrong123!';
  const db = new FakeDb([
    {
      id: 1,
      username: 'admin',
      password_hash: hashPassword(password, salt),
      password_salt: salt,
      role: 'super_admin',
      display_name: 'Admin Root',
      default_branch_id: 7,
      permissions_json: JSON.stringify(['sales', 'reports']),
      is_active: true,
      locked_until: null,
      failed_login_count: 0,
      must_change_password: true,
      last_login_at: null,
      tenant_id: 'default',
      account_id: 'default',
    },
  ], [], [{ key: 'storeName', value: 'Z Systems', tenant_id: 'default' }], [{ user_id: 1, branch_id: 7, tenant_id: 'default' }, { user_id: 1, branch_id: 9, tenant_id: 'default' }]);

  const service = new SessionService(db as any, new FakeConfigService({ LOGIN_MAX_ATTEMPTS: 3, LOGIN_LOCKOUT_MINUTES: 15 }) as any, { log: async () => {} } as any);

  const invalid1 = await service.authenticate('admin', 'wrong-pass');
  assert.equal(invalid1, null);
  assert.equal(db.users[0].failed_login_count, 1);
  assert.equal(db.users[0].locked_until, null);

  await service.authenticate('admin', 'wrong-pass');
  assert.equal(db.users[0].failed_login_count, 2);

  await service.authenticate('admin', 'wrong-pass');
  assert.equal(db.users[0].failed_login_count, 0);
  assert.ok((db.users[0].locked_until as any) instanceof Date);

  db.users[0].locked_until = null;
  const oldHash = db.users[0].password_hash;
  const oldSalt = db.users[0].password_salt;
  const valid = expectSession(await service.authenticate('admin', password, { ipAddress: '127.0.0.1', userAgent: 'spec' }));
  assert.ok(valid);
  assert.equal(db.sessions.length, 1);
  assert.equal(db.sessions[0].tenant_id, 'default');
  assert.equal(db.sessions[0].account_id, 'default');
  assert.equal(db.users[0].failed_login_count, 0);
  assert.equal(valid?.auth.username, 'admin');
  assert.notEqual(db.users[0].password_hash, oldHash);
  assert.notEqual(db.users[0].password_salt, oldSalt);
  assert.ok(db.users[0].password_hash.startsWith('$2'));

  const loginPayload = await service.buildLoginPayload(valid!.auth);
  assert.equal((loginPayload.user as any).displayName, 'Admin Root');
  assert.deepEqual((loginPayload.user as any).branchIds, ['7', '9']);
  assert.equal((loginPayload.user as any).defaultBranchId, '7');
  assert.equal((loginPayload.mustChangePassword as any), true);
  assert.equal((loginPayload.user as any).tenantId, 'default');
  assert.equal((loginPayload.user as any).accountId, 'default');

  const me = await service.buildMePayload(valid!.auth);
  assert.equal((me.user as any).displayName, 'Admin Root');
  assert.deepEqual((me.user as any).branchIds, ['7', '9']);
  assert.equal((me.user as any).defaultBranchId, '7');
  assert.equal((me.security as any).mustChangePassword, true);
  assert.equal((me.user as any).tenantId, 'default');
  assert.equal((me.user as any).accountId, 'default');

  const auth = valid!.auth as AuthContext;
  await assert.rejects(async () => {
    await service.changePassword(auth, password, '   ');
  }, /PASSWORD_REQUIRED/);

  await service.changePassword(auth, password, 'TempPass1234');
  await service.changePassword(auth, 'TempPass1234', 'AdminEvenStronger123!');

  // Verify that any user belonging to a non-platform tenant CAN NEVER have super_admin role
  const tenantUser: UserRow = {
    id: 99,
    username: 'tenant_owner',
    display_name: 'Tenant Owner',
    password_hash: hashPassword(password, salt),
    password_salt: salt,
    role: 'super_admin',
    permissions_json: '["sales"]',
    is_active: true,
    locked_until: null,
    failed_login_count: 0,
    tenant_id: 'tenant-customer-99',
    account_id: 'account-99',
  };
  db.users.push(tenantUser);
  const tenantLogin = expectSession(await service.authenticate('tenant_owner', password));
  assert.ok(tenantLogin);
  assert.equal(tenantLogin!.auth.role, 'admin', 'Session auth.role for non-platform tenant MUST be admin, never super_admin');
  const tenantPayload = await service.buildLoginPayload(tenantLogin!.auth);
  assert.equal((tenantPayload.user as any).role, 'admin', 'Login payload for non-platform tenant MUST have role admin');
  const tenantMe = await service.buildMePayload(tenantLogin!.auth);
  assert.equal((tenantMe.user as any).role, 'admin', 'Me payload for non-platform tenant MUST have role admin');

  // Multi-tenant disambiguation & mobile-first login tests:
  // Two cashiers in different tenants with SAME username 'cashier_common' and SAME password
  const cashierPass = 'CashierCommon123!';
  const cashierSalt = 'salt_c';
  const cashierRagab: UserRow = {
    id: 101,
    username: 'cashier_common',
    phone: '01011111111',
    password_hash: hashPassword(cashierPass, cashierSalt),
    password_salt: cashierSalt,
    role: 'cashier',
    permissions_json: '["sales"]',
    is_active: true,
    locked_until: null,
    failed_login_count: 0,
    tenant_id: 'tenant-ragab',
    account_id: 'account-ragab',
  };
  const cashierMahmoud: UserRow = {
    id: 102,
    username: 'cashier_common',
    phone: '01022222222',
    password_hash: hashPassword(cashierPass, cashierSalt),
    password_salt: cashierSalt,
    role: 'cashier',
    permissions_json: '["sales"]',
    is_active: true,
    locked_until: null,
    failed_login_count: 0,
    tenant_id: 'tenant-mahmoud',
    account_id: 'account-mahmoud',
  };
  db.users.push(cashierRagab, cashierMahmoud);

  // 1. Attempting login with ambiguous username + same password MUST REJECT with disambiguation error!
  await assert.rejects(async () => {
    await service.authenticate('cashier_common', cashierPass);
  }, /مسجلة لدى أكثر من منشأة/);

  // 2. Logging in with Ragab's phone MUST succeed and lock to Ragab
  const ragabLogin = expectSession(await service.authenticate('01011111111', cashierPass));
  assert.ok(ragabLogin);
  assert.equal(ragabLogin?.auth.tenantId, 'tenant-ragab');
  assert.equal(ragabLogin?.auth.userId, 101);

  // 3. Logging in with Mahmoud's phone MUST succeed and lock to Mahmoud
  const mahmoudLogin = expectSession(await service.authenticate('01022222222', cashierPass));
  assert.ok(mahmoudLogin);
  assert.equal(mahmoudLogin?.auth.tenantId, 'tenant-mahmoud');
  assert.equal(mahmoudLogin?.auth.userId, 102);

  // 4. Logging in with username + companyCode MUST succeed and lock to that company
  const scopedRagab = expectSession(await service.authenticate('cashier_common', cashierPass, { companyCode: 'tenant-ragab' }));
  assert.ok(scopedRagab);
  assert.equal(scopedRagab?.auth.tenantId, 'tenant-ragab');
  assert.equal(scopedRagab?.auth.userId, 101);
}

/**
 * MFA-1: كلمة المرور الصحيحة وحدها **لا تُنشئ جلسة** لحساب فعّل المصادقة الثنائية.
 *
 * هذا هو الثابت الذي تقوم عليه الميزة كلها. لو عاد `authenticate` يوماً يُنشئ الجلسة ثم
 * "يطلب" الرمز، صار العامل الثاني نافذة في الواجهة لا بوابة: صف الجلسة موجود والكوكي صدر،
 * ومن يتكلم مع الـAPI مباشرة لا يمر على الواجهة أصلاً.
 */
async function runMfaGate(): Promise<void> {
  const password = 'Str0ngPass!';
  const salt = 'mfa-salt';
  const db = new FakeDb([
    {
      id: 1,
      username: 'owner',
      phone: '01000000000',
      password_hash: hashPassword(password, salt),
      password_salt: salt,
      role: 'admin',
      display_name: 'Owner',
      default_branch_id: null,
      permissions_json: JSON.stringify(['sales']),
      is_active: true,
      locked_until: null,
      failed_login_count: 0,
      must_change_password: false,
      last_login_at: null,
      tenant_id: 'default',
      account_id: 'default',
    },
  ]);
  const service = new SessionService(
    db as any,
    new FakeConfigService({ LOGIN_MAX_ATTEMPTS: 3, LOGIN_LOCKOUT_MINUTES: 15 }) as any,
    { log: async () => {} } as any,
  );

  // بلا صف مصادقة ثنائية: جلسة كالمعتاد.
  expectSession(await service.authenticate('owner', password));
  assert.equal(db.sessions.length, 1, 'an account without MFA still logs in normally');

  // إعداد بدأ ولم يُؤكَّد (confirmed_at = null) يجب ألّا يحجب الدخول — وإلا قفلنا من بدأ ولم يُكمل.
  db.sessions.length = 0;
  db.userMfa.push({ user_id: 1, tenant_id: 'default', confirmed_at: null });
  expectSession(await service.authenticate('owner', password));
  assert.equal(db.sessions.length, 1, 'an unconfirmed MFA setup must not lock the user out');

  // مؤكَّد + بلا سر توقيع في السحابة: يُرفض إصدار التحدي بدل أن يُوقَّع بمفتاح معروف
  // (نفس قاعدة الفشل الآمن في `portal-token.ts` §2.5).
  db.sessions.length = 0;
  db.userMfa[0].confirmed_at = new Date();
  const savedSecret = process.env.SESSION_SECRET;
  const savedCsrfSecret = process.env.SESSION_CSRF_SECRET;
  const savedMode = process.env.APP_MODE;
  process.env.APP_MODE = 'CLOUD_SAAS';
  delete process.env.SESSION_SECRET;
  delete process.env.SESSION_CSRF_SECRET;
  await assert.rejects(
    async () => service.authenticate('owner', password),
    /PORTAL_TOKEN_SECRET_MISSING|إعداد الأمان/,
    'issuing an MFA challenge must fail closed when no signing secret is configured',
  );
  assert.equal(db.sessions.length, 0, 'a failed challenge must not leave a session behind');

  // مؤكَّد + السر مضبوط: تحدٍّ بلا جلسة.
  process.env.SESSION_SECRET = 'session-secret-for-spec-0123456789';
  const challenge = await service.authenticate('owner', password);
  assert.ok(challenge, 'a correct password must still be accepted');
  assert.ok(isMfaChallenge(challenge), 'a confirmed MFA account must get a challenge, not a session');
  assert.equal(db.sessions.length, 0, 'NO session row may exist before the second factor');
  assert.ok((challenge as any).mfaToken, 'the challenge must carry a signed token');
  assert.ok(!(challenge as any).sessionId, 'the challenge must not leak a session id');

  // كلمة مرور خاطئة تبقى خاطئة: لا تحدٍّ ولا جلسة.
  db.userMfa[0].confirmed_at = new Date();
  const wrong = await service.authenticate('owner', 'wrong-pass');
  assert.equal(wrong, null, 'MFA must not turn a wrong password into a challenge');
  assert.equal(db.sessions.length, 0);

  if (savedSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = savedSecret;
  if (savedCsrfSecret === undefined) delete process.env.SESSION_CSRF_SECRET;
  else process.env.SESSION_CSRF_SECRET = savedCsrfSecret;
  if (savedMode === undefined) delete process.env.APP_MODE;
  else process.env.APP_MODE = savedMode;
}

run()
  .then(() => runMfaGate())
  .then(() => {
    console.log('session-auth.spec: ok');
  });


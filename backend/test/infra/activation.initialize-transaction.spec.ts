import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { ForbiddenException } from '@nestjs/common';
import { ActivationService } from '../../src/modules/activation/activation.service';

type SettingsRow = { key: string; value: string };
type BranchRow = { id: number; name: string; code: string; is_active: boolean };
type LocationRow = { id: number; branch_id: number; name: string; code: string; is_active: boolean };
type UserRow = { id: number; username: string; display_name: string; role: string };
type UserBranchRow = { user_id: number; branch_id: number };

type DbState = {
  settings: SettingsRow[];
  branches: BranchRow[];
  stock_locations: LocationRow[];
  users: UserRow[];
  user_branches: UserBranchRow[];
  nextIds: {
    branch: number;
    location: number;
    user: number;
  };
};

function createState(): DbState {
  return {
    settings: [],
    branches: [],
    stock_locations: [],
    users: [],
    user_branches: [],
    nextIds: { branch: 1, location: 1, user: 1 },
  };
}

function cloneState(state: DbState): DbState {
  return JSON.parse(JSON.stringify(state)) as DbState;
}

class FakeSelectBuilder {
  private filterColumn = '';
  private filterValue: unknown;

  constructor(
    private readonly table: keyof DbState,
    private readonly state: DbState,
  ) {}

  select(): this {
    return this;
  }

  where(column: string, _op: string, value: unknown): this {
    this.filterColumn = column;
    this.filterValue = value;
    return this;
  }

  async executeTakeFirst() {
    if (this.table !== 'settings') return undefined;
    if (this.filterColumn !== 'key') return undefined;
    return this.state.settings.find((row) => row.key === String(this.filterValue)) || undefined;
  }

  async executeTakeFirstOrThrow() {
    if (this.table !== 'users') throw new Error(`Unsupported count table: ${this.table}`);
    return { count: this.state.users.length };
  }
}

class FakeInsertBuilder {
  private payload: Record<string, unknown> = {};
  private ignoreConflict = false;

  constructor(
    private readonly table: 'settings' | 'branches' | 'stock_locations' | 'users' | 'user_branches',
    private readonly state: DbState,
    private readonly failOnTable: string | null,
  ) {}

  values(payload: Record<string, unknown>): this {
    this.payload = payload;
    return this;
  }

  onConflict(
    handler: (builder: {
      column: (name: string) => { doUpdateSet: (payload: Record<string, unknown>) => unknown };
      columns: (names: string[]) => { doNothing: () => unknown };
    }) => unknown,
  ): this {
    handler({
      column: (_name: string) => ({
        doUpdateSet: (_payload: Record<string, unknown>) => null,
      }),
      columns: (_names: string[]) => ({
        doNothing: () => {
          this.ignoreConflict = true;
          return null;
        },
      }),
    });
    return this;
  }

  returning(): this {
    return this;
  }

  async execute() {
    if (this.failOnTable === this.table) throw new Error(`forced_${this.table}_failure`);

    if (this.table === 'settings') {
      const key = String(this.payload.key || '');
      const value = String(this.payload.value || '');
      const existing = this.state.settings.find((row) => row.key === key);
      if (existing) existing.value = value;
      else this.state.settings.push({ key, value });
      return;
    }

    if (this.table === 'user_branches') {
      const row = {
        user_id: Number(this.payload.user_id || 0),
        branch_id: Number(this.payload.branch_id || 0),
      };
      const duplicate = this.state.user_branches.some(
        (entry) => entry.user_id === row.user_id && entry.branch_id === row.branch_id,
      );
      if (!duplicate || !this.ignoreConflict) this.state.user_branches.push(row);
    }
  }

  async executeTakeFirstOrThrow() {
    if (this.failOnTable === this.table) throw new Error(`forced_${this.table}_failure`);

    if (this.table === 'branches') {
      const row = {
        id: this.state.nextIds.branch++,
        name: String(this.payload.name || ''),
        code: String(this.payload.code || ''),
        is_active: Boolean(this.payload.is_active),
      };
      this.state.branches.push(row);
      return { id: row.id };
    }

    if (this.table === 'stock_locations') {
      const row = {
        id: this.state.nextIds.location++,
        branch_id: Number(this.payload.branch_id || 0),
        name: String(this.payload.name || ''),
        code: String(this.payload.code || ''),
        is_active: Boolean(this.payload.is_active),
      };
      this.state.stock_locations.push(row);
      return { id: row.id };
    }

    if (this.table === 'users') {
      const row = {
        id: this.state.nextIds.user++,
        username: String(this.payload.username || ''),
        display_name: String(this.payload.display_name || ''),
        role: String(this.payload.role || ''),
      };
      this.state.users.push(row);
      return { id: row.id };
    }

    throw new Error(`Unsupported insert table: ${this.table}`);
  }
}

class FakeDb {
  constructor(
    public state: DbState,
    private readonly failOnTable: string | null = null,
  ) {}

  selectFrom(table: 'settings' | 'users') {
    return new FakeSelectBuilder(table, this.state);
  }

  insertInto(table: 'settings' | 'branches' | 'stock_locations' | 'users' | 'user_branches') {
    return new FakeInsertBuilder(table, this.state, this.failOnTable);
  }

  transaction() {
    return {
      execute: async <T>(work: (trx: FakeDb) => Promise<T>) => {
        const snapshot = cloneState(this.state);
        const trx = new FakeDb(snapshot, this.failOnTable);
        const result = await work(trx);
        this.state = snapshot;
        return result;
      },
    };
  }
}

function createService(failOnTable: string | null = null) {
  const db = new FakeDb(createState(), failOnTable);
  const service = new ActivationService(
    db as any,
    { get: (key: string) => (key === 'LICENSE_MODE' ? 'server' : undefined) } as any,
  );
  return { db, service };
}

const payload = {
  storeName: 'My Store',
  theme: 'light',
  branchName: 'Main Branch',
  branchCode: 'MAIN',
  locationName: 'Front Store',
  locationCode: 'POS-1',
  adminDisplayName: 'Bootstrap Admin',
  adminUsername: 'root',
  adminPassword: 'StrongPassword!234',
};

async function run(): Promise<void> {
  {
    const { db, service } = createService('users');
    await assert.rejects(() => service.initialize(payload), /forced_users_failure/);
    assert.equal(db.state.settings.length, 0);
    assert.equal(db.state.branches.length, 0);
    assert.equal(db.state.stock_locations.length, 0);
    assert.equal(db.state.users.length, 0);
    assert.equal(db.state.user_branches.length, 0);
  }

  {
    const { db, service } = createService();
    const result = await service.initialize(payload);
    assert.equal(result.ok, true);
    assert.equal(result.setupRequired, false);
    assert.equal(db.state.settings.find((row) => row.key === 'storeName')?.value, 'My Store');
    assert.equal(db.state.branches.length, 1);
    assert.equal(db.state.stock_locations.length, 1);
    assert.equal(db.state.users.length, 1);
    assert.equal(db.state.user_branches.length, 1);
    await assert.rejects(() => service.initialize(payload), ForbiddenException);
  }

  console.log('activation.initialize-transaction.spec: ok');
}

void run();

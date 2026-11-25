import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Migration, MigrationProvider as KyselyMigrationProvider } from 'kysely';

export class FileMigrationProvider implements KyselyMigrationProvider {
  constructor(private readonly migrationsPath: string) {}

  async getMigrations(): Promise<Record<string, Migration>> {
    if (!this.migrationsPath || !existsSync(this.migrationsPath)) {
      return {};
    }

    const isTsRuntime = __filename.endsWith('.ts');

    const files = readdirSync(this.migrationsPath)
      .filter(
        (name) =>
          !name.endsWith('.d.ts') &&
          !name.endsWith('.map') &&
          (isTsRuntime ? name.endsWith('.ts') || name.endsWith('.js') : name.endsWith('.js')),
      )
      .sort();

    const migrations: Record<string, Migration> = {};

    for (const fileName of files) {
      const fullPath = join(this.migrationsPath, fileName);
      if (!existsSync(fullPath)) continue;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic migration path: require() is the only sync loader that reads both .ts (ts-node) and .js (compiled) migration files; await import() cannot load .ts under ts-node CJS.
        const migrationModule = require(fullPath) as {
          migration?: Migration;
          default?: Migration;
          up?: Migration['up'];
          down?: Migration['down'];
        };
        const key = fileName.replace(/\.(ts|js)$/, '');
        if (migrationModule.migration) {
          migrations[key] = migrationModule.migration;
        } else if (migrationModule.default) {
          migrations[key] = migrationModule.default;
        } else if (typeof migrationModule.up === 'function') {
          migrations[key] = {
            up: migrationModule.up,
            down: migrationModule.down,
          };
        }
      } catch (err) {
        // If a file is being written or missing during hot reload, throw clear error
        throw new Error(
          `Failed to load migration file at ${fullPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return migrations;
  }
}

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..', '..');
const source = readFileSync(join(root, 'backend/src/modules/settings/services/settings-demo-data.service.ts'), 'utf8');
const frontend = readFileSync(
  join(root, 'frontend/src/features/settings/components/workspace-sections/SettingsBackupImportSection.tsx'),
  'utf8',
);

assert.ok(!source.includes("createPasswordRecord('1')"), 'demo users must not share the known password 1');
assert.ok(source.includes('randomBytes(18)'), 'demo users must receive random temporary passwords');
assert.ok(source.includes('must_change_password: true'), 'demo users must change the temporary password');
assert.ok(
  !source.includes('Backup attempt logged, continue with operation'),
  'destructive demo flows must fail closed when backup fails',
);
assert.ok(!frontend.includes('كاشير1 (1)'), 'the UI must not publish a known demo password');

console.log('demo-data-safety.spec: temporary credentials and fail-closed backup guard hold');

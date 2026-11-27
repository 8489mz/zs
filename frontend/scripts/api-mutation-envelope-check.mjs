import fs from 'node:fs';
import path from 'node:path';

const files = [
  'src/shared/api/sales.api.ts',
  'src/features/purchases/api/purchases.api.ts',
  'src/features/pos/api/pos.api.ts'
];

const failures = [];
for (const rel of files) {
  const full = path.resolve(process.cwd(), rel);
  const source = fs.readFileSync(full, 'utf8');
  if (!source.includes('unwrapEntity')) {
    failures.push(`${rel}: missing unwrapEntity usage for entity envelopes`);
  }
}

if (failures.length) {
  console.error('Phase23 API envelope checks failed:');
  failures.forEach((item) => console.error(`- ${item}`));
  process.exit(1);
}

console.log('Phase23 API envelope checks passed.');

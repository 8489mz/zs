import fs from 'node:fs';
import path from 'node:path';

const frontendRoot = path.resolve(process.cwd());
const repoRoot = path.resolve(frontendRoot, '..');
const featuresDir = path.join(frontendRoot, 'src', 'features');
const backendDir = path.join(repoRoot, 'backend', 'src');

function walk(dir, matcher) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full, matcher));
    else if (matcher(full)) files.push(full);
  }
  return files;
}

function normalizePath(prefix, route) {
  const joined = `/${[prefix, route].filter(Boolean).join('/')}`.replace(/\/+/g, '/');
  return joined.replace(/\/:(\w+)/g, '/:$1').replace(/\/$/, '') || '/';
}

function readContracts() {
  const files = walk(featuresDir, (file) => file.endsWith('contracts.ts'));
  const contracts = [];
  const pattern = /\{\s*feature:\s*'([^']+)',\s*name:\s*'([^']+)',\s*method:\s*'(GET|POST|PUT|DELETE)',\s*path:\s*'([^']+)'(?:,\s*responseKey:\s*'([^']+)')?\s*\}/g;
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(pattern)) {
      contracts.push({ file: path.relative(frontendRoot, file), feature: match[1], name: match[2], method: match[3], path: match[4], responseKey: match[5] || '' });
    }
  }
  return contracts;
}

function expandDecoratorValues(raw, fallback = '') {
  if (!raw) return [fallback];
  return raw
    .replace(/[[\]'"]/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 || fallback === '');
}

function readBackendRoutes() {
  const files = walk(backendDir, (file) => file.endsWith('.controller.ts'));
  const routes = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const controllerMatch = source.match(/@Controller\(\s*(\[[^\]]*\]|['"][^'"]*['"])\s*\)/);
    const prefixes = controllerMatch ? expandDecoratorValues(controllerMatch[1], '') : [''];
    const routePattern = /@(Get|Post|Put|Delete)\(\s*(\[[^\]]*\]|['"][^'"]*['"])?\s*\)/g;
    for (const match of source.matchAll(routePattern)) {
      const subPaths = expandDecoratorValues(match[2], '');
      for (const prefix of prefixes) {
        for (const subPath of subPaths) {
          routes.push({
            file: path.relative(repoRoot, file),
            method: match[1].toUpperCase(),
            path: normalizePath(prefix, subPath),
          });
        }
      }
    }
  }
  return routes;
}

const contracts = readContracts();
const routes = readBackendRoutes();
const missing = [];

for (const contract of contracts) {
  const found = routes.find((route) => route.method === contract.method && route.path === contract.path);
  if (!found) missing.push(contract);
}

if (missing.length) {
  console.error('\nAPI contract alignment failed. Missing backend routes:\n');
  missing.forEach((entry) => console.error(`- [${entry.method}] ${entry.path} (${entry.feature}.${entry.name}) from ${entry.file}`));
  process.exit(1);
}

console.log(`\nAPI contract alignment passed for ${contracts.length} contracts.`);

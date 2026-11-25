const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'src', 'modules');
const issues = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith('.controller.ts')) inspect(full);
  }
}

function inspect(file) {
  const txt = fs.readFileSync(file, 'utf8');
  const usesGuard = txt.includes('PermissionsGuard');
  const hasProtectedRoute = txt.includes('@RequirePermissions(');
  if (hasProtectedRoute && !usesGuard) {
    issues.push(
      `${path.relative(path.join(__dirname, '..'), file)}: has @RequirePermissions without PermissionsGuard import/use`,
    );
  }
}

walk(root);
if (issues.length) {
  console.error('[check:permissions] issues found');
  for (const issue of issues) console.error('-', issue);
  process.exit(1);
}
console.log('[check:permissions] ok');

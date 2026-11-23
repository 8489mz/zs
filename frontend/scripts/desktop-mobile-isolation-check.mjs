import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const srcRoot = path.join(projectRoot, 'src');

const errors = [];

// 1. Settings polish CSS check
const polishCssPath = path.join(srcRoot, 'styles/partials/settings-detail-polish.css');
if (fs.existsSync(polishCssPath)) {
  const content = fs.readFileSync(polishCssPath, 'utf8');
  if (/\.settings-page-shell\s+\.document-prototype-column\s*\{[^}]*max-width:\s*100%\s*!important/.test(content)) {
    errors.push('CRITICAL: settings-detail-polish.css contains max-width: 100% !important on document-prototype-column, breaking desktop 1280px invariant.');
  }
  if (!/\.settings-page-shell\s+\.document-prototype-column\s*\{[^}]*max-width:\s*1280px\s*!important/.test(content)) {
    errors.push('CRITICAL: settings-detail-polish.css must enforce max-width: 1280px !important on document-prototype-column for desktop.');
  }
} else {
  errors.push(`Missing file: ${polishCssPath}`);
}

// 2. Draft notice centering check
const draftNoticePath = path.join(srcRoot, 'shared/components/draft-state-notice.tsx');
if (fs.existsSync(draftNoticePath)) {
  const content = fs.readFileSync(draftNoticePath, 'utf8');
  if (content.includes("left: '24px'")) {
    errors.push('CRITICAL: draft-state-notice.tsx contains hardcoded left: 24px, causing banner to float on left edge on desktop.');
  }
  if (!content.includes("left: '50%'") || !content.includes("transform: 'translateX(-50%)'")) {
    errors.push('CRITICAL: draft-state-notice.tsx must use centered positioning (left: 50%, translateX(-50%)).');
  }
} else {
  errors.push(`Missing file: ${draftNoticePath}`);
}

// 3. SettingsMainForm duplicate notice check — reads the J1 slice file, where the
// single <DraftStateNotice /> use lives after the #108 split (it moved out of the
// facade; the facade now contains 0). Re-pointed at the #108 merge (same class
// as the desktop-mobile-isolation.spec.ts re-point).
const settingsMainFormPath = path.join(srcRoot, 'features/settings/components/forms/settings-main-form/settings-main-form-notices.tsx');
if (fs.existsSync(settingsMainFormPath)) {
  const content = fs.readFileSync(settingsMainFormPath, 'utf8');
  const count = (content.match(/<DraftStateNotice/g) || []).length;
  if (count !== 1) {
    errors.push(`CRITICAL: SettingsMainForm has ${count} instances of DraftStateNotice, expected exactly 1.`);
  }
}

if (errors.length > 0) {
  console.error('[DESKTOP-MOBILE ISOLATION GUARD FAILED]:');
  for (const err of errors) {
    console.error(` - ${err}`);
  }
  process.exit(1);
}

console.log('[DESKTOP-MOBILE ISOLATION GUARD PASSED]: Desktop 1280px invariant and mobile encapsulation verified.');

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Desktop vs Mobile Viewport Isolation & 1280px Layout Invariants', () => {
  const frontendDir = path.resolve(__dirname, '../../..');

  it('enforces Universal 1280px centered layout on SettingsPageShell and forbids 100% width on desktop', () => {
    const settingsPolishCssPath = path.join(frontendDir, 'src/styles/partials/settings-detail-polish.css');
    expect(fs.existsSync(settingsPolishCssPath)).toBe(true);

    const cssContent = fs.readFileSync(settingsPolishCssPath, 'utf8');

    // Must NEVER contain max-width: 100% !important; margin: 0 !important; on desktop
    expect(cssContent).not.toMatch(/\.settings-page-shell\s+\.document-prototype-column\s*\{[^}]*max-width:\s*100%\s*!important/);
    expect(cssContent).not.toMatch(/\.settings-page-shell\s+\.document-prototype-column\s*\{[^}]*margin:\s*0\s*!important/);

    // Must enforce 1280px centered layout
    expect(cssContent).toMatch(/\.settings-page-shell\s+\.document-prototype-column\s*\{[^}]*max-width:\s*1280px\s*!important/);
    expect(cssContent).toMatch(/\.settings-page-shell\s+\.document-prototype-column\s*\{[^}]*margin:\s*0\s+auto\s*!important/);
  });

  it('guarantees SettingsPageShell enforces 1280px container bounds matching TreasuryPage', () => {
    const shellTsxPath = path.join(frontendDir, 'src/features/settings/components/SettingsPageShell.tsx');
    expect(fs.existsSync(shellTsxPath)).toBe(true);

    const shellContent = fs.readFileSync(shellTsxPath, 'utf8');
    expect(shellContent).toContain("maxWidth: '1280px'");
    expect(shellContent).toContain("margin: '0 auto'");
  });

  it('strictly isolates mobile CSS rules inside @media queries in mobile-layout.css', () => {
    const mobileLayoutCssPath = path.join(frontendDir, 'src/styles/partials/mobile-layout.css');
    expect(fs.existsSync(mobileLayoutCssPath)).toBe(true);

    const mobileCssContent = fs.readFileSync(mobileLayoutCssPath, 'utf8');

    // Verify that the mobile full-width settings overrides are strictly enclosed within @media
    const mobileMediaIndex = mobileCssContent.indexOf('@media (max-width: 900px)');
    expect(mobileMediaIndex).toBeGreaterThan(0);

    const settingsMobileOverrideIndex = mobileCssContent.indexOf('.settings-page-shell .document-prototype-column');
    expect(settingsMobileOverrideIndex).toBeGreaterThan(mobileMediaIndex);
  });

  it('enforces centered positioning for DraftStateNotice and forbids hardcoded left: 24px', () => {
    const noticeTsxPath = path.join(frontendDir, 'src/shared/components/draft-state-notice.tsx');
    expect(fs.existsSync(noticeTsxPath)).toBe(true);

    const noticeContent = fs.readFileSync(noticeTsxPath, 'utf8');
    // Must NOT float at left: '24px'
    expect(noticeContent).not.toContain("left: '24px'");

    // Must be centered
    expect(noticeContent).toContain("left: '50%'");
    expect(noticeContent).toContain("transform: 'translateX(-50%)'");
  });

  it('prevents duplicate DraftStateNotice renders in SettingsMainForm', () => {
    const mainFormTsxPath = path.join(frontendDir, 'src/features/settings/components/forms/settings-main-form/settings-main-form-notices.tsx');
    expect(fs.existsSync(mainFormTsxPath)).toBe(true);

    const formContent = fs.readFileSync(mainFormTsxPath, 'utf8');
    const noticeOccurrences = (formContent.match(/<DraftStateNotice/g) || []).length;
    expect(noticeOccurrences).toBe(1);
  });
});

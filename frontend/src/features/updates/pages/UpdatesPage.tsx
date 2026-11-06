/* Updates page (INV-UPDATES-PAGE-BUILT): a dedicated /updates route that
 * renders the existing SystemUpdatesSection, so an online tenant can reach
 * the update centre (current version, channel, changelog, check button)
 * without the desktop-only settings section. Apply actions stay
 * desktop-gated inside the section: on cloud the backend always 400s
 * apply, so the page never offers a dead apply button.
 */
import { SystemUpdatesSection } from '@/features/settings';

export function UpdatesPage() {
  return (
    <main className="document-prototype-column" dir="rtl">
      <SystemUpdatesSection />
    </main>
  );
}

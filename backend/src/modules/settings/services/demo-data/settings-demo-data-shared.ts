// D7 (INV-DTO-SETTINGS-22): SeedDemoDataDto is a decorated class now
// (src/modules/settings/dto/seed-demo-data.dto.ts) so the global pipe
// validates the seed body; re-exported here so service imports are unchanged.
export { SeedDemoDataDto } from '../../dto/seed-demo-data.dto';

export interface DemoCredential {
  username: string;
  temporaryPassword: string;
  mustChangePassword: true;
}

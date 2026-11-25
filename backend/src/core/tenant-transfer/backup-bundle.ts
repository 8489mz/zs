import * as crypto from 'crypto';
import AdmZip from 'adm-zip';
import type { PackageManifest } from './tenant-package';

// Nightly backup bundle: ONE zip holding the full server dump (for rebuilding a whole server) and a
// ready tenant package per tenant (for moving one shop to a desktop install, or restoring one shop,
// without touching the others). manifest.json lists every entry with its sha256.
//
// Optional encryption is byte-compatible with
//   openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -salt
// so a bundle can also be opened with openssl alone if this tool is ever unavailable.

export const BUNDLE_FORMAT = 'ZSBUNDLE1';
export const FULL_DUMP_ENTRY = 'full/zsystems_db.sql.gz';
const OPENSSL_MAGIC = Buffer.from('Salted__', 'ascii');
const PBKDF2_ITERATIONS = 200_000;

export interface BundleTenantEntry {
  tenantId: string;
  slug: string;
  businessName: string;
  entry: string;
  rows: number;
  bytes: number;
  sha256: string;
}

export interface BundleManifest {
  format: string;
  createdAt: string;
  migration: { latest: string; count: number };
  full: { entry: string; bytes: number; sha256: string } | null;
  tenants: BundleTenantEntry[];
  failedTenants: { tenantId: string; error: string }[];
}

const sha256 = (buffer: Buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

export function tenantEntryName(manifest: PackageManifest): string {
  const safeSlug = (manifest.tenant.slug || 'tenant').replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 40) || 'tenant';
  const safeId = manifest.tenant.id.replace(/[^A-Za-z0-9_-]+/g, '').slice(0, 12) || 'id';
  return `tenants/${safeSlug}__${safeId}.zsbak`;
}

export function buildBundle(input: {
  fullDump: Buffer | null;
  packages: { manifest: PackageManifest; buffer: Buffer }[];
  failedTenants?: { tenantId: string; error: string }[];
  migration: { latest: string; count: number };
}): { zip: Buffer; manifest: BundleManifest } {
  const zip = new AdmZip();
  const manifest: BundleManifest = {
    format: BUNDLE_FORMAT,
    createdAt: new Date().toISOString(),
    migration: input.migration,
    full: null,
    tenants: [],
    failedTenants: input.failedTenants ?? [],
  };
  if (input.fullDump) {
    zip.addFile(FULL_DUMP_ENTRY, input.fullDump);
    manifest.full = { entry: FULL_DUMP_ENTRY, bytes: input.fullDump.length, sha256: sha256(input.fullDump) };
  }
  for (const pkg of input.packages) {
    const entry = tenantEntryName(pkg.manifest);
    zip.addFile(entry, pkg.buffer);
    manifest.tenants.push({
      tenantId: pkg.manifest.tenant.id,
      slug: pkg.manifest.tenant.slug,
      businessName: pkg.manifest.tenant.businessName,
      entry,
      rows: Object.values(pkg.manifest.tables).reduce((sum, t) => sum + t.rows, 0),
      bytes: pkg.buffer.length,
      sha256: sha256(pkg.buffer),
    });
  }
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
  // entries are already gzip: store them, don't compress twice
  for (const e of zip.getEntries()) e.header.method = 0;
  return { zip: zip.toBuffer(), manifest };
}

export function isEncrypted(buffer: Buffer): boolean {
  return buffer.length > 16 && buffer.subarray(0, 8).equals(OPENSSL_MAGIC);
}

function deriveKeyIv(passphrase: string, salt: Buffer) {
  const material = crypto.pbkdf2Sync(Buffer.from(passphrase, 'utf8'), salt, PBKDF2_ITERATIONS, 48, 'sha256');
  return { key: material.subarray(0, 32), iv: material.subarray(32, 48) };
}

export function encryptBundle(buffer: Buffer, passphrase: string): Buffer {
  const salt = crypto.randomBytes(8);
  const { key, iv } = deriveKeyIv(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([OPENSSL_MAGIC, salt, cipher.update(buffer), cipher.final()]);
}

export function decryptBundle(buffer: Buffer, passphrase: string): Buffer {
  if (!isEncrypted(buffer)) return buffer;
  const salt = buffer.subarray(8, 16);
  const { key, iv } = deriveKeyIv(passphrase, salt);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  try {
    const plain = Buffer.concat([decipher.update(buffer.subarray(16)), decipher.final()]);
    // A decrypted bundle must at least start with a valid zip header ('PK', 0x50 0x4b) or gzip header (0x1f 0x8b).
    // In AES-CBC with PKCS#7, ~1 out of 256 random decryptions happens to have valid padding by coincidence,
    // which would silently return corrupted bytes instead of throwing bad decrypt.
    if (plain.length < 2 || !((plain[0] === 0x50 && plain[1] === 0x4b) || (plain[0] === 0x1f && plain[1] === 0x8b))) {
      throw new Error('Wrong backup passphrase, or the file is damaged');
    }
    return plain;
  } catch (err: any) {
    if (err?.message && err.message.includes('Wrong backup passphrase')) throw err;
    throw new Error('Wrong backup passphrase, or the file is damaged');
  }
}

export function readBundle(buffer: Buffer): { manifest: BundleManifest; entry: (name: string) => Buffer } {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new Error('Not a backup bundle (zip expected)');
  }
  const manifestEntry = zip.getEntry('manifest.json');
  if (!manifestEntry) throw new Error('Not a backup bundle (manifest.json missing)');
  const manifest = JSON.parse(manifestEntry.getData().toString('utf8')) as BundleManifest;
  if (manifest.format !== BUNDLE_FORMAT) throw new Error(`Unsupported bundle format ${manifest.format}`);

  const expected = new Map<string, string>();
  if (manifest.full) expected.set(manifest.full.entry, manifest.full.sha256);
  for (const t of manifest.tenants) expected.set(t.entry, t.sha256);

  return {
    manifest,
    entry: (name: string) => {
      const found = zip.getEntry(name);
      if (!found) throw new Error(`Bundle has no entry ${name}`);
      const data = found.getData();
      const hash = expected.get(name);
      if (hash && sha256(data) !== hash) throw new Error(`Bundle entry ${name} is corrupt (checksum mismatch)`);
      return data;
    },
  };
}

// Accepts a tenant package, a bundle, or an encrypted bundle, and returns the chosen tenant package.
export function resolveTenantPackage(
  file: Buffer,
  options: { passphrase?: string; pick?: string },
): { packageBuffer: Buffer; bundleTenants: BundleTenantEntry[] | null } {
  const plain = isEncrypted(file) ? decryptBundle(file, requirePassphrase(options.passphrase)) : file;
  // a tenant package is gzip (1f 8b); a bundle is zip (PK)
  if (plain[0] === 0x1f && plain[1] === 0x8b) return { packageBuffer: plain, bundleTenants: null };
  const bundle = readBundle(plain);
  const pick = (options.pick || '').trim();
  const matches = bundle.manifest.tenants.filter((t) => !pick || t.slug === pick || t.tenantId === pick);
  if (matches.length !== 1) {
    const err = new Error(
      pick ? `No single tenant "${pick}" in this bundle` : 'The bundle holds several tenants: choose one',
    );
    (err as any).bundleTenants = bundle.manifest.tenants;
    throw err;
  }
  return { packageBuffer: bundle.entry(matches[0].entry), bundleTenants: bundle.manifest.tenants };
}

function requirePassphrase(passphrase?: string): string {
  if (!passphrase) throw new Error('This backup is encrypted: the backup passphrase is required');
  return passphrase;
}

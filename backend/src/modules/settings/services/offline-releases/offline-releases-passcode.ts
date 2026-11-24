import { BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';

/**
 * Per-release random activation passcode (INV-OFFLINE-UPDATE-PASSCODE-RANDOM).
 *
 * The old scheme derived the code deterministically as SHA-256 of a fixed
 * literal + version, so anyone holding the public repo could recompute the
 * code for ANY version — and the release script also published the code in
 * plaintext inside the tracked release manifests (17 of 19 manifests carry
 * one). A passcode that must travel through a public channel cannot be a
 * secret. The value is now fresh randomness per call: the release script is
 * the only place a code is minted (printed once for the seller), the service
 * never derives or invents one, and verification only ever compares against
 * a stored/provisioned value. Rows that already hold a stored code keep
 * verifying against it — old releases keep their old codes (prospective
 * only, nothing is revoked).
 */
export function generateReleasePasscode(version: string): string {
  const clean = version.replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
  const h = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `ZS-UPD-${clean || '100'}-${h.substring(0, 4)}-${h.substring(4, 8)}`;
}

/**
 * Fail-closed resolution of the expected passcode: a gate with no stored or
 * manifest-supplied code has nothing to compare against, so the update is
 * refused instead of deriving a code the caller could also compute.
 */
export function expectedPasscodeOrFail(candidate: string | null | undefined, _version: string): string {
  const expected = (candidate || '').trim();
  if (!expected) {
    throw new BadRequestException('لم يتم تخصيص كود تفعيل لهذا الإصدار بعد.');
  }
  return expected;
}

/** Operator-approved package SHA256: update packages must be pinned out-of-band, never trusted because
 * a user supplied a manifest/passcode in the package itself. */
export function assertTrustedOfflineUpdatePackage(buffer: Buffer, expectedDigest: string | undefined): void {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > 128 * 1024 * 1024) {
    throw new BadRequestException('Update package size exceeds 128 MiB or is empty');
  }
  if (!expectedDigest || !/^[a-f0-9]{64}$/i.test(expectedDigest)) {
    throw new BadRequestException('The trusted update SHA256 must be provisioned on the device');
  }
  const expected = Buffer.from(expectedDigest, 'hex');
  const received = crypto.createHash('sha256').update(buffer).digest();
  if (!crypto.timingSafeEqual(expected, received)) {
    throw new BadRequestException('Update package SHA256 does not match the operator-approved release');
  }
}

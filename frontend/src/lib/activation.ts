// A secret salt hidden inside the app. Keep it consistent!
const SECRET_SALT = 'zsystems_pos_secure_salt_2026_!@#$';

/**
 * Hash a string using SHA-256 (Web Crypto API)
 */
async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

/**
 * Generate a deterministic license key from a given machine ID.
 */
export async function generateLicenseKey(machineId: string): Promise<string> {
  const hash = await sha256(`${machineId}::${SECRET_SALT}`);
  // Return the first 24 characters, formatted as XXXX-XXXX-XXXX-XXXX
  const shortHash = hash.substring(0, 16).toUpperCase();
  return `${shortHash.substring(0, 4)}-${shortHash.substring(4, 8)}-${shortHash.substring(8, 12)}-${shortHash.substring(12, 16)}`;
}

/**
 * Verify if the provided license key matches the expected one for the machine ID.
 */
export async function verifyLicense(machineId: string, providedKey: string): Promise<boolean> {
  if (!providedKey) return false;
  const expectedKey = await generateLicenseKey(machineId);
  return providedKey.trim() === expectedKey;
}

/**
 * Interface to the Electron preload script.
 */
export async function getHardwareId(): Promise<string> {
  // @ts-expect-error window.electronAPI is exposed by the Electron preload with no TS types
  if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.getHardwareId) {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        // @ts-expect-error window.electronAPI is exposed by the Electron preload with no TS types
        const id = await window.electronAPI.getHardwareId();
        if (id && typeof id === 'string' && id.trim().length > 3) {
          return id.trim();
        }
      } catch (e) {
        console.warn(`[ACTIVATION] getHardwareId attempt ${attempt + 1} waiting for bridge:`, e);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  // Fallback for normal browser dev (if someone runs 'npm run dev' without electron)
  return 'WIN-DEVICE-AUTO-01';
}

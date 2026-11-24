import * as path from 'path';

/**
 * Determines the portable/Electron root directory.
 * - In Electron mode: ELECTRON_EXE_PATH env is set by main.cjs → use its directory.
 * - In portable mode: CWD is app/backend → go 2 levels up.
 */
export function getPortableRoot(): string {
  if (process.env.ELECTRON_EXE_PATH) {
    return path.dirname(process.env.ELECTRON_EXE_PATH);
  }
  return path.resolve(process.cwd(), '../..');
}

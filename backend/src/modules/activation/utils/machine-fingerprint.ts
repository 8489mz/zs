import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import os from 'os';
import { execFileSync } from 'child_process';

function safeExec(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function readWindowsMachineGuid(): string {
  const output = safeExec('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid']);
  const line = output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => /^MachineGuid\s+/i.test(entry));
  return line ? line.split(/\s+/).pop() || '' : '';
}

function readWindowsCsProductUuid(): string {
  const wmic = safeExec('wmic', ['csproduct', 'get', 'uuid']);
  const val = wmic
    .split(/\r?\n/)
    .map((x) => x.trim())
    .find((x) => x && x.toLowerCase() !== 'uuid');
  if (val) return val;
  const ps = safeExec('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_ComputerSystemProduct).UUID']);
  return ps
    ? ps
        .split(/\r?\n/)
        .map((x) => x.trim())
        .find(Boolean) || ''
    : '';
}

function readWindowsBiosSerial(): string {
  const wmic = safeExec('wmic', ['bios', 'get', 'serialnumber']);
  const val = wmic
    .split(/\r?\n/)
    .map((x) => x.trim())
    .find((x) => x && x.toLowerCase() !== 'serialnumber');
  if (val) return val;
  const ps = safeExec('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_BIOS).SerialNumber']);
  return ps
    ? ps
        .split(/\r?\n/)
        .map((x) => x.trim())
        .find(Boolean) || ''
    : '';
}

function readLinuxFile(path: string): string {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8').trim() : '';
  } catch {
    return '';
  }
}

function collectParts(): string[] {
  const platform = os.platform();
  const parts: string[] = [platform, os.arch()];

  if (platform === 'win32') {
    parts.push(readWindowsMachineGuid(), readWindowsCsProductUuid(), readWindowsBiosSerial());
  } else if (platform === 'linux') {
    parts.push(
      readLinuxFile('/etc/machine-id'),
      readLinuxFile('/sys/class/dmi/id/product_uuid'),
      readLinuxFile('/sys/class/dmi/id/board_serial'),
    );
  } else {
    parts.push(os.hostname());
  }

  return parts.filter(Boolean);
}

export interface MachineFingerprint {
  machineId: string;
  fingerprintHash: string;
  rawParts: string[];
}

let cachedFingerprint: MachineFingerprint | null = null;

export function getMachineFingerprint(): MachineFingerprint {
  if (cachedFingerprint) {
    return cachedFingerprint;
  }
  const rawParts = collectParts();
  const raw = rawParts.join('|');
  const digest = createHash('sha256').update(raw).digest('hex').toUpperCase();
  const short =
    digest
      .slice(0, 24)
      .match(/.{1,4}/g)
      ?.join('-') || digest.slice(0, 24);
  cachedFingerprint = { machineId: short, fingerprintHash: digest, rawParts };
  return cachedFingerprint;
}

export function clearCachedMachineFingerprint(): void {
  cachedFingerprint = null;
}

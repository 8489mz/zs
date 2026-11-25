// Type declarations for the untyped file-size guard script
// (backend/scripts/file-size-guard.cjs). The .cjs module ships no types,
// so without this file a static `import` of it fails type-checking with
// TS7016 (implicit any) and the guard spec had to use require(). The
// shapes below mirror the .cjs exports exactly (L2 verified against
// file-size-guard.cjs); keep them in sync when the script changes.

export declare const FILE_SIZE_CAP: number;

export declare function countLines(source: string): number;

export declare function loadBaseline(baselineFile: string): {
  cap: number;
  entries: Record<string, number>;
};

export declare function enforceFileSizeCap(options: {
  srcRoot: string;
  baselineFile: string;
  allowlist?: Set<string>;
  skipPrefixes?: string[];
  cap?: number;
  updateBaseline?: boolean;
}): {
  checked: number;
  overCap: number;
  baselineEntries: number;
  shrunk: Array<{ file: string; from: number; to: number }>;
  violations: string[];
};

/**
 * Professional AI Client-side Background Removal (WebAssembly / WebWorker)
 * 100% Client-side execution in merchant's browser (Mobile & Desktop).
 * 0% server CPU / RAM load.
 *
 * Integrated Precision Engine:
 * 1. Mask-Only Acquisition from AI (model: 'medium' with 'small' fallback).
 * 2. Largest Connected Component (LCC) Subject Isolation with Detached Cap / Accessory Tolerance.
 * 3. Guided Edge Filtering: Aligns the alpha mask boundary with physical luminance contours of the source photo.
 * 4. Sub-pixel Edge Decontamination & Defringing (Un-premultiplication): Annihilates white studio halo.
 * 5. Smart Bounding Box Auto-Trim with protective padding.
 * 6. Lossless PNG export; WebP 0.92 is a lossy derivative used only when PNG exceeds 350KB.
 */

import { assertImageInputWithinLimits } from './image-input-guards';

export interface AiRemovalProgress {
  key: string;
  current: number;
  total: number;
  percent: number;
}

export type ProgressCallback = (progress: AiRemovalProgress) => void;

export type MatteProvider = (input: {
  bitmap: ImageBitmap;
  source: Blob;
  width: number;
  height: number;
  rgb: Uint8ClampedArray;
  onProgress?: ProgressCallback;
  model?: 'medium' | 'small';
}) => Promise<Float32Array>;

export interface ProductCutoutOptions {
  /** أطول ضلع للصورة التي يعمل عليها التركيب. الافتراضي: 2048 للديسكتوب و1536 للجوال. */
  maxLongEdge?: number;
  /** أطول ضلع لعمليات الشكل (LCC والهالة). الافتراضي 1024. */
  workLongEdge?: number;
  /** Retained for compatibility (no longer gates anything; large components >1.5% area are always kept regardless of distance). */
  allowMultipleProducts?: boolean;
  /** حشوة حول المنتج بعد القص بالبكسل. الافتراضي 12. */
  trimPadding?: number;
  /** يصنع نسخة WebP للعرض إضافة إلى نسخة PNG الرئيسية؟ الافتراضي true. */
  alsoExportWebp?: boolean;
  /** جودة نسخة WebP فقط. الافتراضي 0.92. */
  webpQuality?: number;
  /** موديل الذكاء الاصطناعي المطلوب: الافتراضي 'medium' */
  model?: 'medium' | 'small';
  onSubjectWarning?: (coverage: number) => void;
}

export interface ProductCutoutResult {
  png: Blob;
  webp?: Blob;
  width: number;
  height: number;
  /** لون الخلفية المقدّر */
  backgroundColor: [number, number, number];
  foregroundCoverage?: number;
  subjectWarning?: boolean;
}

const IMGLY_ASSET_PUBLIC_PATH =
  'https://staticimgly.com/@imgly/background-removal-data/1.5.8/dist/';

let aiModulePromise: Promise<any> | null = null;
let isModelPreloaded = false;

export async function getAiRemovalModule() {
  if (!aiModulePromise) {
    // Dynamic ESM import from CDN, zero impact on app shell startup bundle (PERFORMANCE_CONSTITUTION)
    const cdnUrl = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.8/+esm';
    aiModulePromise = (new Function('url', 'return import(url)')(cdnUrl) as Promise<any>);
  }
  return aiModulePromise;
}

export async function preloadAiModel(onProgress?: ProgressCallback): Promise<boolean> {
  try {
    const mod = await getAiRemovalModule();
    if (mod.preload) {
      await mod.preload({
        publicPath: IMGLY_ASSET_PUBLIC_PATH,
        model: 'medium',
        device: 'gpu',
        proxyToWorker: true,
        progress: (key: string, current: number, total: number) => {
          if (onProgress && total > 0) {
            onProgress({
              key,
              current,
              total,
              percent: Math.round((current / total) * 100),
            });
          }
        },
      });
    }
    isModelPreloaded = true;
    return true;
  } catch (err) {
    console.warn('AI Background model preload warning:', err);
    return false;
  }
}

export function isAiModelReady(): boolean {
  return isModelPreloaded;
}

/* ------------------------------------------------------------------ */
/* أدوات المعالجة الرياضية للحواف والصور                             */
/* ------------------------------------------------------------------ */

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

function smoothstep(edge0: number, edge1: number, v: number): number {
  const t = clamp01((v - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function chroma(r: number, g: number, b: number): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function canvasFromImageData(data: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = data.width;
  canvas.height = data.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(data, 0, 0);
  return canvas;
}

function resizeRgbViaCanvas(
  rgb: Uint8ClampedArray,
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number,
): Uint8ClampedArray {
  const data = new ImageData(new Uint8ClampedArray(rgb), width, height);
  const src = canvasFromImageData(data);
  const dst = document.createElement('canvas');
  dst.width = targetWidth;
  dst.height = targetHeight;
  const ctx = dst.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, targetWidth, targetHeight);
  return ctx.getImageData(0, 0, targetWidth, targetHeight).data;
}

/** تغيير حجم قناع عائم عبر رسمه كصورة رمادية ثم قراءته بدقة */
function resizeMatteViaCanvas(
  matte: Float32Array,
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number,
): Float32Array {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const v = clamp255(Math.round(matte[i] * 255));
    pixels[i * 4] = v;
    pixels[i * 4 + 1] = v;
    pixels[i * 4 + 2] = v;
    pixels[i * 4 + 3] = 255;
  }
  const src = canvasFromImageData(new ImageData(pixels, width, height));
  const dst = document.createElement('canvas');
  dst.width = targetWidth;
  dst.height = targetHeight;
  const ctx = dst.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, targetWidth, targetHeight);
  const out = ctx.getImageData(0, 0, targetWidth, targetHeight).data;
  const result = new Float32Array(targetWidth * targetHeight);
  for (let i = 0; i < result.length; i++) result[i] = out[i * 4] / 255;
  return result;
}

/** تمويه صندوقي قابل للفصل (أفقي ثم عمودي) بمجموع منزلق */
function boxBlurFloat(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  if (radius <= 0) return src.slice();
  const tmp = new Float32Array(src.length);
  const dst = new Float32Array(src.length);
  const window = 2 * radius + 1;
  for (let y = 0; y < height; y++) {
    let sum = 0;
    const row = y * width;
    for (let x = -radius; x <= radius; x++) {
      sum += src[row + Math.min(width - 1, Math.max(0, x))];
    }
    for (let x = 0; x < width; x++) {
      tmp[row + x] = sum / window;
      const xOut = Math.min(width - 1, Math.max(0, x - radius));
      const xIn = Math.min(width - 1, Math.max(0, x + radius + 1));
      sum += src[row + xIn] - src[row + xOut];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) {
      sum += tmp[Math.min(height - 1, Math.max(0, y)) * width + x];
    }
    for (let y = 0; y < height; y++) {
      dst[y * width + x] = sum / window;
      const yOut = Math.min(height - 1, Math.max(0, y - radius));
      const yIn = Math.min(height - 1, Math.max(0, y + radius + 1));
      sum += tmp[yIn * width + x] - tmp[yOut * width + x];
    }
  }
  return dst;
}

/* ------------------------------------------------------------------ */
/* عمليات الشكل المورفولوجية: تمديد/تآكل، ملء الثقوب، المكونات المتصلة */
/* ------------------------------------------------------------------ */

/** تمديد أو تآكل ثنائي بنافذة مربعة عبر صورة تكاملية */
function morphBinary(mask: Uint8Array, width: number, height: number, radius: number, dilate: boolean): Uint8Array {
  if (radius <= 0) return mask.slice();
  const integral = new Uint32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += mask[y * width + x];
      integral[(y + 1) * (width + 1) + x + 1] = integral[y * (width + 1) + x + 1] + rowSum;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        integral[(y1 + 1) * (width + 1) + x1 + 1] -
        integral[y0 * (width + 1) + x1 + 1] -
        integral[(y1 + 1) * (width + 1) + x0] +
        integral[y0 * (width + 1) + x0];
      out[y * width + x] = dilate ? (sum > 0 ? 1 : 0) : sum === area ? 1 : 0;
    }
  }
  return out;
}

/** ملء الثقوب: كل بكسل خلفية لا يصل إليه الفيضان من الحدود فهو ثقب داخلي */
function fillHoles(binary: Uint8Array, width: number, height: number): Uint8Array {
  const reached = new Uint8Array(binary.length);
  const stack: number[] = [];
  const pushIfBackground = (i: number) => {
    if (binary[i] === 0 && !reached[i]) {
      reached[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < width; x++) {
    pushIfBackground(x);
    pushIfBackground((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    pushIfBackground(y * width);
    pushIfBackground(y * width + width - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % width;
    const y = (i / width) | 0;
    if (x > 0) pushIfBackground(i - 1);
    if (x < width - 1) pushIfBackground(i + 1);
    if (y > 0) pushIfBackground(i - width);
    if (y < height - 1) pushIfBackground(i + width);
  }
  const out = binary.slice();
  for (let i = 0; i < out.length; i++) {
    if (binary[i] === 0 && !reached[i]) out[i] = 1;
  }
  return out;
}

interface ComponentInfo {
  size: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** ترقيم المكونات المتصلة (4 جيران) بمكدس آمن لحدود الصفوف */
function labelComponents(
  binary: Uint8Array,
  width: number,
  height: number,
): { labels: Int32Array; components: ComponentInfo[] } {
  const labels = new Int32Array(binary.length).fill(-1);
  const components: ComponentInfo[] = [];
  const stack: number[] = [];
  for (let start = 0; start < binary.length; start++) {
    if (binary[start] === 0 || labels[start] !== -1) continue;
    const id = components.length;
    const info: ComponentInfo = { size: 0, minX: width, minY: height, maxX: 0, maxY: 0 };
    labels[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width;
      const y = (i / width) | 0;
      info.size++;
      if (x < info.minX) info.minX = x;
      if (x > info.maxX) info.maxX = x;
      if (y < info.minY) info.minY = y;
      if (y > info.maxY) info.maxY = y;
      const neighbours = [i - 1, i + 1, i - width, i + width];
      if (x === 0) neighbours[0] = -1;
      if (x === width - 1) neighbours[1] = -1;
      if (y === 0) neighbours[2] = -1;
      if (y === height - 1) neighbours[3] = -1;
      for (const n of neighbours) {
        if (n >= 0 && binary[n] === 1 && labels[n] === -1) {
          labels[n] = id;
          stack.push(n);
        }
      }
    }
    components.push(info);
  }
  return { labels, components };
}

function bboxGap(a: ComponentInfo, b: ComponentInfo): number {
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
  return Math.hypot(dx, dy);
}

/* ------------------------------------------------------------------ */
/* تقدير لون الخلفية وكبح الضباب في شريط الحافة                        */
/* ------------------------------------------------------------------ */

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 255;
}

function estimateBackgroundColor(
  rgb: Uint8ClampedArray,
  matte: Float32Array,
  width: number,
  height: number,
): [number, number, number] {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const border = Math.max(2, Math.round(Math.min(width, height) * 0.03));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const onBorder = x < border || y < border || x >= width - border || y >= height - border;
      if (!onBorder) continue;
      const i = y * width + x;
      if (matte[i] > 0.05) continue;
      rs.push(rgb[i * 4]);
      gs.push(rgb[i * 4 + 1]);
      bs.push(rgb[i * 4 + 2]);
    }
  }
  if (rs.length < 50) {
    const s = Math.max(4, Math.round(Math.min(width, height) * 0.06));
    const corners: Array<[number, number]> = [
      [0, 0],
      [width - s, 0],
      [0, height - s],
      [width - s, height - s],
    ];
    for (const [cx, cy] of corners) {
      for (let y = cy; y < cy + s; y++) {
        for (let x = cx; x < cx + s; x++) {
          const i = (y * width + x) * 4;
          rs.push(rgb[i]);
          gs.push(rgb[i + 1]);
          bs.push(rgb[i + 2]);
        }
      }
    }
  }
  return [median(rs), median(gs), median(bs)];
}

/* ------------------------------------------------------------------ */
/* الفلتر الموجَّه: مطابقة حافة القناع مع التباين الفيزيائي الحقيقي للمنتج */
/* ------------------------------------------------------------------ */

function guidedFilter(
  guide: Float32Array,
  matte: Float32Array,
  width: number,
  height: number,
  radius: number,
  eps: number,
): Float32Array {
  const meanI = boxBlurFloat(guide, width, height, radius);
  const meanP = boxBlurFloat(matte, width, height, radius);
  const corrI = new Float32Array(guide.length);
  const corrIP = new Float32Array(guide.length);
  for (let i = 0; i < guide.length; i++) {
    corrI[i] = guide[i] * guide[i];
    corrIP[i] = guide[i] * matte[i];
  }
  const meanII = boxBlurFloat(corrI, width, height, radius);
  const meanIP = boxBlurFloat(corrIP, width, height, radius);
  const a = new Float32Array(guide.length);
  const b = new Float32Array(guide.length);
  for (let i = 0; i < guide.length; i++) {
    const varI = Math.max(0, meanII[i] - meanI[i] * meanI[i]);
    const covIP = meanIP[i] - meanI[i] * meanP[i];
    a[i] = covIP / (varI + eps);
    b[i] = meanP[i] - a[i] * meanI[i];
  }
  const meanA = boxBlurFloat(a, width, height, radius);
  const meanB = boxBlurFloat(b, width, height, radius);
  const out = new Float32Array(guide.length);
  for (let i = 0; i < guide.length; i++) out[i] = clamp01(meanA[i] * guide[i] + meanB[i]);
  return out;
}

// Trim a fading floor-shadow skirt below the product. Measured
// 2026-10-31 on a real AI cut (Fine Oud Wood can, 319x1252 WebP):
// below the last solid row, a 7-row tail faded 255 -> 23 in max
// alpha, narrowed 209 -> 23 px wide, and stayed neutral gray
// (R ~= G ~= B, brightening toward the white floor) — the can's
// contact shadow, kept because it touches the product. On white it
// is invisible; composited on orange it reads as a blurry veil
// under the product. The trim below fires ONLY for that exact
// shape: a short PRESENT span below the last wide solid row, every
// row non-solid, max alpha non-increasing, faint through much of
// its length (at least 40% of rows at max alpha at most 0.6) and
// fading out, never wider
// than the product, bright and low-chroma throughout. Anything
// else (thin legs, a translucent base, a strong shadow, a colored
// reflection) is left untouched.
function trimBottomShadowSkirt(
  alpha: Float32Array,
  rgb: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  const opaqueCount = new Uint32Array(height);
  const maxA = new Float32Array(height);
  const presentCount = new Uint32Array(height);
  for (let y = 0; y < height; y++) {
    let opaque = 0;
    let mx = 0;
    let present = 0;
    const rowStart = y * width;
    for (let x = 0; x < width; x++) {
      const a = alpha[rowStart + x];
      if (a > mx) mx = a;
      if (a >= 0.98) opaque++;
      if (a > 0.02) present++;
    }
    opaqueCount[y] = opaque;
    maxA[y] = mx;
    presentCount[y] = present;
  }
  let refW = 0;
  for (let y = 0; y < height; y++) if (opaqueCount[y] > refW) refW = opaqueCount[y];
  if (refW === 0) return;
  let lastSolid = -1;
  const solidFloor = refW * 0.5;
  for (let y = height - 1; y >= 0; y--) {
    if (opaqueCount[y] >= solidFloor) {
      lastSolid = y;
      break;
    }
  }
  if (lastSolid < 0) return;
  const tailStart = lastSolid + 1;
  // The skirt is the PRESENT span below the last solid row, not the
  // distance to the bottom of the image: a product photographed
  // mid-frame leaves empty margin below the skirt, and counting it
  // made the height guard reject every real skirt (measured
  // 2026-10-31 on the 819x1024 original: 74 rows to the image
  // bottom vs a 10-row skirt fading 255 -> 10).
  let lastPresentRow = -1;
  for (let y = height - 1; y > lastSolid; y--) {
    if (presentCount[y] > 0) {
      lastPresentRow = y;
      break;
    }
  }
  if (lastPresentRow < 0) return;
  const tailSpan = lastPresentRow - tailStart + 1;
  if (tailSpan > Math.max(24, Math.ceil(height * 0.03))) return;
  let presentRows = 0;
  let lastPresent = -1;
  let lumSum = 0;
  let chromaSum = 0;
  let presentPx = 0;
  let prevMax = 1;
  const tailMaxA: number[] = [];
  for (let y = tailStart; y <= lastPresentRow; y++) {
    if (opaqueCount[y] >= solidFloor) return;
    if (presentCount[y] > refW) return;
    if (maxA[y] > prevMax + 0.03) return;
    prevMax = maxA[y];
    if (presentCount[y] === 0) continue;
    presentRows++;
    lastPresent = y;
    tailMaxA.push(maxA[y]);
    const rowStart = y * width;
    for (let x = 0; x < width; x++) {
      const a = alpha[rowStart + x];
      if (a <= 0.02) continue;
      const r = rgb[(rowStart + x) * 4];
      const g = rgb[(rowStart + x) * 4 + 1];
      const b = rgb[(rowStart + x) * 4 + 2];
      lumSum += 0.299 * r + 0.587 * g + 0.114 * b;
      chromaSum += Math.max(r, g, b) - Math.min(r, g, b);
      presentPx++;
    }
  }
  if (presentRows < 3 || lastPresent < 0) return;
  if (maxA[lastPresent] > 0.5) return;
  // The tail must be faint through much of its length, not a strong
  // plateau that only drops in its last row (a base plate or a
  // solid stand). Measured 2026-10-31: the real skirt has about
  // half its rows at max alpha at most 0.6, while a uniform 0.95
  // plateau has almost none. A median cannot tell them apart when
  // the rim's bottom rows stay opaque, so count faint rows instead.
  let faintRows = 0;
  for (const m of tailMaxA) if (m <= 0.6) faintRows++;
  if (faintRows < Math.ceil(tailMaxA.length * 0.4)) return;
  if (presentPx === 0) return;
  const meanLum = lumSum / presentPx;
  const meanChroma = chromaSum / presentPx;
  if (meanLum < 140 || meanChroma > 20) return;
  for (let y = tailStart; y < height; y++) {
    alpha.fill(0, y * width, (y + 1) * width);
  }
}

/* ------------------------------------------------------------------ */
/* جوهر المعالجة: تنقية القناع والاحتفاظ بالمجسم الرئيسي مع فك خلط الألوان */
/* ------------------------------------------------------------------ */

export function refineProductMatte(
  rgb: Uint8ClampedArray,
  width: number,
  height: number,
  rawMatte: Float32Array,
  options: ProductCutoutOptions = {},
): { rgba: Uint8ClampedArray; backgroundColor: [number, number, number] } {
  const workLongEdge = options.workLongEdge ?? 1024;
  const scale = Math.min(1, workLongEdge / Math.max(width, height));
  const workW = Math.max(1, Math.round(width * scale));
  const workH = Math.max(1, Math.round(height * scale));

  const workRgb = scale < 1 ? resizeRgbViaCanvas(rgb, width, height, workW, workH) : rgb;
  const workMatte =
    scale < 1 ? resizeMatteViaCanvas(rawMatte, width, height, workW, workH) : rawMatte.slice();

  // Adaptive foreground-decision threshold. The model matte is not
  // always near-binary: on some photos (measured 2026-10-31, Cherry
  // Pop, all model/device configs) its alpha mean is ~0.15 with only
  // ~16% of pixels above the historic 0.32, yet its shape traces the
  // products. A fixed 0.32 then erases the subject. The threshold
  // below is the median of the clearly-present matte values (> 0.08),
  // clamped to [0.08, 0.32]: strong mattes keep exactly 0.32, soft
  // mattes lower the decision point so the subject survives
  // binarization, and faint haze (<= 0.08) can never become
  // foreground by itself. LCC, edge suppression, and the snap in
  // step 3b still decide what is finally kept.
  const binaryThreshold = (() => {
    const FLOOR = 0.08;
    const CEIL = 0.32;
    const hist = new Uint32Array(256);
    for (let i = 0; i < workMatte.length; i++) {
      const b = Math.round(workMatte[i] * 255);
      hist[b < 0 ? 0 : b > 255 ? 255 : b]++;
    }
    const floorBin = Math.floor(FLOOR * 255);
    let present = 0;
    for (let b = floorBin + 1; b < 256; b++) present += hist[b];
    if (present === 0) return CEIL;
    let acc = 0;
    const half = present / 2;
    for (let b = floorBin + 1; b < 256; b++) {
      acc += hist[b];
      if (acc >= half) {
        const t = b / 255;
        return t < FLOOR ? FLOOR : t > CEIL ? CEIL : t;
      }
    }
    return CEIL;
  })();

  // 1) قناع ثنائي ناعم العتبة، مع إغلاق الفجوات الدقيقة وملء الثقوب
  const binary = new Uint8Array(workW * workH);
  for (let i = 0; i < binary.length; i++) binary[i] = workMatte[i] > binaryThreshold ? 1 : 0;
  const closed = morphBinary(morphBinary(binary, workW, workH, 2, true), workW, workH, 2, false);
  const filled = fillHoles(closed, workW, workH);

  // 2) الاحتفاظ بالمجسّم الرئيسي فقط (LCC) مع ضم الأجزاء القريبة (كغطاء العبوة المنفصل)
  const { labels, components } = labelComponents(filled, workW, workH);
  const keep = new Uint8Array(components.length);
  if (components.length) {
    let main = 0;
    for (let i = 1; i < components.length; i++) {
      if (components[i].size > components[main].size) main = i;
    }
    keep[main] = 1;
    const nearGap = Math.max(6, Math.round(workW * 0.015));
    const minNearArea = workW * workH * 0.0008;
    for (let i = 0; i < components.length; i++) {
      if (i === main) continue;
      // Components over 1.5% of work area are always kept (multi-product sets), near components by gap rule, rest deleted as mist.
      if (components[i].size > workW * workH * 0.015) {
        keep[i] = 1;
      } else if (components[i].size >= minNearArea && bboxGap(components[i], components[main]) <= nearGap) {
        keep[i] = 1;
      }
    }
  }
  for (let i = 0; i < workMatte.length; i++) {
    const label = labels[i];
    if (label < 0 || !keep[label]) workMatte[i] = 0;
  }

  // 3) كبح الضباب في شريط الحافة فقط (عزل قلب المنتج 100% عبر التآكل بـ 3 بكسل)
  const keptBinary = new Uint8Array(workW * workH);
  for (let i = 0; i < keptBinary.length; i++) keptBinary[i] = workMatte[i] > binaryThreshold ? 1 : 0;
  const core = morphBinary(keptBinary, workW, workH, 3, false);
  const outer = morphBinary(keptBinary, workW, workH, 5, true);
  const bg = estimateBackgroundColor(workRgb, workMatte, workW, workH);
  for (let i = 0; i < workMatte.length; i++) {
    if (core[i] === 1 || outer[i] === 0) continue;
    const a = workMatte[i];
    if (a >= 0.85 || a <= 0) continue;
    const r = workRgb[i * 4];
    const g = workRgb[i * 4 + 1];
    const b = workRgb[i * 4 + 2];
    const dist = Math.hypot(r - bg[0], g - bg[1], b - bg[2]);
    if (dist < 42) {
      workMatte[i] = a * (0.12 + 0.88 * (dist / 42));
    } else if (luminance(r, g, b) >= 192 && chroma(r, g, b) <= 22 && dist < 70) {
      workMatte[i] = a * 0.6;
    }
  }

  // 3b) Snap decided foreground to fully opaque. The binary mask (> the
  // adaptive decision threshold) is the foreground decision; fractional
  // matte inside it is model uncertainty, not translucency. Step 3
  // already ran, so suppressed halo below the threshold is not snapped
  // back. The guided filter and feathering after this step re-soften
  // only the edge band.
  for (let i = 0; i < workMatte.length; i++) {
    if (keptBinary[i] === 1 && workMatte[i] > binaryThreshold) workMatte[i] = 1;
  }

  // 4) إعادة القناع إلى الدقة الكاملة، ثم تطبيق الفلتر الموجَّه
  const fullMatte = scale < 1 ? resizeMatteViaCanvas(workMatte, workW, workH, width, height) : workMatte;
  const guide = new Float32Array(width * height);
  for (let i = 0; i < guide.length; i++) {
    guide[i] = luminance(rgb[i * 4], rgb[i * 4 + 1], rgb[i * 4 + 2]) / 255;
  }
  let alpha = guidedFilter(guide, fullMatte, width, height, 2, 0.01);

  // 5) تنعيم خفيف جداً على الحافة فقط (1 بكسل)
  const blurred = boxBlurFloat(alpha, width, height, 1);
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] > 0.02 && alpha[i] < 0.98) alpha[i] = alpha[i] * 0.5 + blurred[i] * 0.5;
  }

  // 5b) إزالة ذيل ظل الأرضية الباهت أسفل المنتج فقط عند تطابق شكل الظل المقاس (trimBottomShadowSkirt)
  trimBottomShadowSkirt(alpha, rgb, width, height);

  // 6) فك خلط لون الخلفية (Un-premultiply) لإزالة الهالة البيضاء نهائياً
  const fullBg = estimateBackgroundColor(rgb, alpha, width, height);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < alpha.length; i++) {
    const a = clamp01(alpha[i]);
    let r = rgb[i * 4];
    let g = rgb[i * 4 + 1];
    let b = rgb[i * 4 + 2];
    if (a > 0.02 && a < 0.98) {
      const strength = smoothstep(0.05, 0.6, a) * 0.85;
      const inv = 1 - a;
      const fr = clamp255((r - inv * fullBg[0]) / a);
      const fg = clamp255((g - inv * fullBg[1]) / a);
      const fb = clamp255((b - inv * fullBg[2]) / a);
      r = r + (fr - r) * strength;
      g = g + (fg - g) * strength;
      b = b + (fb - b) * strength;
    }
    const alphaByte = clamp255(Math.round(a * 255));
    if (alphaByte === 0) {
      r = 0;
      g = 0;
      b = 0;
    }
    rgba[i * 4] = clamp255(Math.round(r));
    rgba[i * 4 + 1] = clamp255(Math.round(g));
    rgba[i * 4 + 2] = clamp255(Math.round(b));
    rgba[i * 4 + 3] = alphaByte;
  }
  return { rgba, backgroundColor: fullBg };
}

/* ------------------------------------------------------------------ */
/* قص الفراغات والتصدير النقي (Auto-Trim & Export)                     */
/* ------------------------------------------------------------------ */

function trimImageData(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  padding: number,
): { data: ImageData; width: number; height: number } {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    return { data: new ImageData(new Uint8ClampedArray(rgba), width, height), width, height };
  }
  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(width - 1, maxX + padding);
  maxY = Math.min(height - 1, maxY + padding);
  const tw = maxX - minX + 1;
  const th = maxY - minY + 1;
  const out = new Uint8ClampedArray(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const srcStart = ((minY + y) * width + minX) * 4;
    out.set(rgba.subarray(srcStart, srcStart + tw * 4), y * tw * 4);
  }
  return { data: new ImageData(out, tw, th), width: tw, height: th };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('تعذر ترميز الصورة'))),
      type,
      quality,
    );
  });
}

function isMobileLike(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (typeof navigator.maxTouchPoints === 'number' &&
        navigator.maxTouchPoints > 0 &&
        Math.min(screen.width, screen.height) < 900))
  );
}

/**
 * مزوّد imgly: طلب القناع فقط (type: 'mask') بالموديل المتوسط 'medium'
 */
export async function imglyMaskMatte(input: {
  bitmap: ImageBitmap;
  source: Blob;
  width: number;
  height: number;
  onProgress?: ProgressCallback;
  model?: 'medium' | 'small';
}): Promise<Float32Array> {
  const mod = await getAiRemovalModule();
  const removeFn = (mod.imglyRemoveBackground ?? mod.removeBackground ?? mod.default) as
    | ((source: Blob, config: Record<string, unknown>) => Promise<Blob>)
    | undefined;
  if (!removeFn) throw new Error('لم يتم العثور على دالة إزالة الخلفية في حزمة imgly');

  const modelChoice = input.model ?? 'medium';

  const runAttempt = (
    model: 'medium' | 'small',
    device: 'gpu' | 'cpu',
    proxyToWorker: boolean,
  ): Promise<Blob> => {
    return removeFn(input.source, {
      publicPath: IMGLY_ASSET_PUBLIC_PATH,
      model,
      device,
      proxyToWorker,
      output: { format: 'image/png', type: 'mask' },
      progress: (key: string, current: number, total: number) => {
        if (input.onProgress && total > 0) {
          input.onProgress({
            key,
            current,
            total,
            percent: Math.round((current / total) * 100),
          });
        }
      },
    });
  };

  let maskBlob: Blob;

  try {
    maskBlob = await runAttempt(modelChoice, 'gpu', true);
  } catch (err1) {
    if (modelChoice !== 'small') {
      console.warn(`Fallback: attempt 1 (model: ${modelChoice}, device: gpu) failed, trying model: small, device: gpu`, err1);
      try {
        maskBlob = await runAttempt('small', 'gpu', true);
      } catch (err2) {
        console.warn('Fallback: attempt 2 (model: small, device: gpu) failed, trying model: small, device: cpu', err2);
        maskBlob = await runAttempt('small', 'cpu', false);
      }
    } else {
      console.warn('Fallback: attempt 1 (model: small, device: gpu) failed, trying model: small, device: cpu', err1);
      maskBlob = await runAttempt('small', 'cpu', false);
    }
  }

  const maskBitmap = await createImageBitmap(maskBlob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = maskBitmap.width;
    canvas.height = maskBitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('فشل إنشاء محرك قراءة القناع');
    ctx.drawImage(maskBitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, maskBitmap.width, maskBitmap.height).data;
    const matte = new Float32Array(maskBitmap.width * maskBitmap.height);
    // The imgly mask PNG carries the segmentation in its ALPHA channel:
    // its RGB channels hold the source image colors, not a grayscale
    // matte. Reading red (pixels[i * 4]) made every dark subject
    // transparent — a black sprayer head has R = 0 — no matter how
    // confident the model was. Proven 2026-10-31 by diagnosis v3
    // (mask RGB equals photo RGB at nearly every grid point; two
    // decode paths identical) and v4 (all model/device configs weak
    // in alpha, yet the alpha shape traces the products; the
    // 'foreground' output is byte-identical to 'mask'). Fall back to
    // red only when alpha carries no information at all (constant
    // alpha), which is the grayscale-mask shape other mask producers
    // emit.
    let minAlpha = 255;
    let maxAlpha = 0;
    for (let i = 0; i < matte.length; i++) {
      const a = pixels[i * 4 + 3];
      if (a < minAlpha) minAlpha = a;
      if (a > maxAlpha) maxAlpha = a;
    }
    const matteOffset = maxAlpha > minAlpha ? 3 : 0;
    for (let i = 0; i < matte.length; i++) matte[i] = pixels[i * 4 + matteOffset] / 255;
    if (matte.length === input.width * input.height) return matte;
    return resizeMatteViaCanvas(matte, maskBitmap.width, maskBitmap.height, input.width, input.height);
  } finally {
    maskBitmap.close();
  }
}

/**
 * خط معالجة صور المنتجات المتكامل بدقة كاملة وبدون ضياع جودة
 */
export async function processProductImage(
  file: Blob,
  getMatte: MatteProvider,
  options: ProductCutoutOptions = {},
  onProgress?: ProgressCallback,
): Promise<ProductCutoutResult> {
  await assertImageInputWithinLimits(file);
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const maxLongEdge = options.maxLongEdge ?? (isMobileLike() ? 1536 : 2048);
    const scale = Math.min(1, maxLongEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    const rgb = new Uint8ClampedArray(imageData.data);

    const sourceBlob = await canvasToBlob(canvas, 'image/png');

    const matte = await getMatte({ bitmap, source: sourceBlob, width, height, rgb, onProgress, model: options.model });
    if (matte.length !== width * height) {
      throw new Error(`حجم القناع غير متطابق: ${matte.length} بدلا من ${width * height}`);
    }

    const { rgba, backgroundColor } = refineProductMatte(rgb, width, height, matte, options);

    // Foreground coverage check (one pass without allocating new array)
    let foregroundPixels = 0;
    const totalPixels = width * height;
    for (let i = 0; i < totalPixels; i++) {
      if (rgba[i * 4 + 3] >= 8) {
        foregroundPixels++;
      }
    }
    const foregroundCoverage = totalPixels > 0 ? foregroundPixels / totalPixels : 0;
    const subjectWarning = foregroundCoverage < 0.02 || foregroundCoverage > 0.98;

    const trimmed = trimImageData(rgba, width, height, options.trimPadding ?? 12);

    const outCanvas = document.createElement('canvas');
    outCanvas.width = trimmed.width;
    outCanvas.height = trimmed.height;
    outCanvas.getContext('2d')!.putImageData(trimmed.data, 0, 0);

    const png = await canvasToBlob(outCanvas, 'image/png');
    const result: ProductCutoutResult = {
      png,
      width: trimmed.width,
      height: trimmed.height,
      backgroundColor,
      foregroundCoverage,
      subjectWarning,
    };
    if (options.alsoExportWebp) {
      result.webp = await canvasToBlob(outCanvas, 'image/webp', options.webpQuality ?? 0.92);
    }
    return result;
  } finally {
    bitmap.close();
  }
}

/**
 * الواجهة الرسمية لاستدعاء التفريغ الاحترافي في المنظومة
 */
export async function removeBackgroundWithAi(
  imageSource: string | Blob | File | HTMLImageElement,
  onProgress?: ProgressCallback,
  options: ProductCutoutOptions = {},
): Promise<Blob> {
  let resolvedBlob: Blob;

  if (imageSource instanceof Blob) {
    resolvedBlob = imageSource;
  } else if (typeof imageSource === 'string') {
    if (imageSource.startsWith('data:')) {
      const res = await fetch(imageSource);
      resolvedBlob = await res.blob();
    } else {
      const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
      const absoluteUrl =
        imageSource.startsWith('http://') || imageSource.startsWith('https://')
          ? imageSource
          : new URL(imageSource, baseOrigin).href;

      try {
        const res = await fetch(absoluteUrl, { credentials: 'same-origin' });
        const fetchedBlob = await res.blob();
        if (fetchedBlob.type && !fetchedBlob.type.startsWith('image/')) {
          throw new Error(`استجاب السيرفر بنوع غير صالح: ${fetchedBlob.type}`);
        }
        resolvedBlob = fetchedBlob;
      } catch {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise((resolve, reject) => {
          img.onload = () => resolve(true);
          img.onerror = () => reject(new Error('تعذر تحميل صورة الصنف من الرابط المحدد'));
          img.src = absoluteUrl;
        });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('فشل إنشاء محرك معالجة الصورة');
        ctx.drawImage(img, 0, 0);
        resolvedBlob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('فشل تحويل الصورة إلى بايتات'))), 'image/png');
        });
      }
    }
  } else if (typeof (imageSource as any)?.src === 'string') {
    const img = imageSource as HTMLImageElement;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('فشل إنشاء محرك معالجة الصورة');
    ctx.drawImage(img, 0, 0);
    resolvedBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('فشل تحويل الصورة إلى بايتات'))), 'image/png');
    });
  } else {
    throw new Error('نوع مدخل الصورة غير مدعوم');
  }

  const result = await processProductImage(
    resolvedBlob,
    (input) => imglyMaskMatte({ ...input, onProgress, model: options.model }),
    {
      alsoExportWebp: true,
      webpQuality: 0.92,
      ...options,
    },
    onProgress,
  );

  if (result.subjectWarning && options.onSubjectWarning) {
    options.onSubjectWarning(result.foregroundCoverage ?? 0);
  }

  // إذا كان حجم الـ PNG أقل من أو يساوي 350KB، نعتمد PNG للنقاء المطلق بدون فقدان
  if (result.png.size <= 350 * 1024 || !result.webp) {
    return result.png;
  }
  return result.webp;
}

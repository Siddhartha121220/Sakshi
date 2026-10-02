// Perceptual hashing: docs/PROTOCOL.md §5. Pure pixel-math only — no image codec dependency here,
// so this module runs identically in Node, the browser, and (once ported) Kotlin. Callers are
// responsible for decoding the image to RGB and applying EXIF orientation first (§5.0 steps 1-2);
// everything from luma conversion onward lives here.

export interface RgbImage {
  width: number;
  height: number;
  /** Row-major, 3 bytes per pixel (R, G, B), already EXIF-oriented. */
  rgb: Uint8Array;
}

const MIN_HASHABLE_DIMENSION = 64;

export function toLuma({ width, height, rgb }: RgbImage): Float64Array {
  const luma = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = rgb[i * 3]!;
    const g = rgb[i * 3 + 1]!;
    const b = rgb[i * 3 + 2]!;
    luma[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return luma;
}

/**
 * Box-filter downscale, per docs/PROTOCOL.md §5.0: output (x,y) is the mean of all source pixels
 * whose column falls in [floor(x*W/w), floor((x+1)*W/w)) and whose row falls in the equivalent
 * range. Platform scalers (Bitmap.createScaledBitmap, canvas drawImage) are NOT used because they
 * differ across platforms and would break Kotlin/TypeScript hash agreement.
 */
export function boxDownscale(src: Float64Array, srcW: number, srcH: number, dstW: number, dstH: number): Float64Array {
  const out = new Float64Array(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    const sy0 = Math.floor((y * srcH) / dstH);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * srcH) / dstH));
    for (let x = 0; x < dstW; x++) {
      const sx0 = Math.floor((x * srcW) / dstW);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * srcW) / dstW));
      let sum = 0;
      let count = 0;
      for (let sy = sy0; sy < sy1 && sy < srcH; sy++) {
        for (let sx = sx0; sx < sx1 && sx < srcW; sx++) {
          sum += src[sy * srcW + sx]!;
          count++;
        }
      }
      out[y * dstW + x] = count > 0 ? sum / count : 0;
    }
  }
  return out;
}

/** Orthonormal 1D DCT-II. */
function dct1d(x: Float64Array): Float64Array {
  const n = x.length;
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += x[i]! * Math.cos((Math.PI / n) * (i + 0.5) * k);
    }
    out[k] = (k === 0 ? Math.sqrt(1 / n) : Math.sqrt(2 / n)) * sum;
  }
  return out;
}

/** Separable 2D DCT-II on an n x n row-major block. */
function dct2d(block: Float64Array, n: number): Float64Array {
  const afterRows = new Float64Array(n * n);
  for (let r = 0; r < n; r++) {
    afterRows.set(dct1d(block.slice(r * n, (r + 1) * n)), r * n);
  }
  const out = new Float64Array(n * n);
  const col = new Float64Array(n);
  for (let c = 0; c < n; c++) {
    for (let r = 0; r < n; r++) col[r] = afterRows[r * n + c]!;
    const transformed = dct1d(col);
    for (let r = 0; r < n; r++) out[r * n + c] = transformed[r]!;
  }
  return out;
}

/** Packs bits where bits[0] is the most significant bit (docs/PROTOCOL.md §5.1/§5.2). */
function packBitsMsbFirst(bits: boolean[]): bigint {
  let value = 0n;
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) value |= 1n << BigInt(bits.length - 1 - i);
  }
  return value;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[Math.floor(mid)]!;
}

/** True iff the image is large enough to hash (docs/PROTOCOL.md §5.0 step 4). */
export function isHashable(width: number, height: number): boolean {
  return width >= MIN_HASHABLE_DIMENSION && height >= MIN_HASHABLE_DIMENSION;
}

/** The 64-bit global perceptual hash (docs/PROTOCOL.md §5.1), as an unsigned bigint in [0, 2^64). */
export function computeGlobalPHash(luma: Float64Array, width: number, height: number): bigint {
  const small = boxDownscale(luma, width, height, 32, 32);
  const dct = dct2d(small, 32);

  const low = new Float64Array(64); // top-left 8x8 low-frequency block, row-major (u, v)
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      low[u * 8 + v] = dct[u * 32 + v]!;
    }
  }

  const m = median(Array.from(low));
  const bits: boolean[] = [];
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      bits.push(low[u * 8 + v]! > m);
    }
  }
  return packBitsMsbFirst(bits);
}

/**
 * The 16 per-tile 64-bit dHashes (docs/PROTOCOL.md §5.2), for localising edits. Returns them
 * concatenated as 128 bytes (16 x 8 bytes, big-endian, row-major tile order), matching the
 * `tile_hashes` column in apps/api/db/migrations.
 */
export function computeTileHashes(luma: Float64Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(16 * 8);
  for (let tr = 0; tr < 4; tr++) {
    const y0 = Math.floor((tr * height) / 4);
    const y1 = Math.floor(((tr + 1) * height) / 4);
    for (let tc = 0; tc < 4; tc++) {
      const x0 = Math.floor((tc * width) / 4);
      const x1 = Math.floor(((tc + 1) * width) / 4);
      const tileW = x1 - x0;
      const tileH = y1 - y0;

      const tile = new Float64Array(tileW * tileH);
      for (let y = 0; y < tileH; y++) {
        for (let x = 0; x < tileW; x++) {
          tile[y * tileW + x] = luma[(y0 + y) * width + (x0 + x)]!;
        }
      }

      const small = boxDownscale(tile, tileW, tileH, 9, 8); // 9 wide x 8 tall, per §5.2
      const bits: boolean[] = [];
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          bits.push(small[row * 9 + col]! < small[row * 9 + col + 1]!);
        }
      }
      const hash = packBitsMsbFirst(bits);
      const tileIndex = tr * 4 + tc;
      const view = new DataView(out.buffer, tileIndex * 8, 8);
      view.setBigUint64(0, hash, false);
    }
  }
  return out;
}

export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x !== 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

export function phashToHex(hash: bigint): string {
  return hash.toString(16).padStart(16, "0");
}

export function phashFromHex(hex: string): bigint {
  return BigInt(`0x${hex}`);
}

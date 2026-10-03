// Runs in Node against hand-written fakes of createImageBitmap/OffscreenCanvas, rather than a real
// browser. That is enough to pin the two spec behaviours this module got wrong in a way no
// node-environment test caught and that broke *every* upload in a real browser:
//   1. a closed ImageBitmap reports width/height as 0 (html.spec.whatwg.org/#dom-imagebitmap-close),
//      so anything read off the bitmap must be read before close();
//   2. getImageData throws IndexSizeError when asked for a zero-width rect, which is how (1)
//      surfaced to the user ("The source width is 0").
import { describe, it, expect, afterEach } from "vitest";
import { decodeImageFile } from "../src/lib/image-decode.js";

const WIDTH = 4;
const HEIGHT = 3;

interface FakeBitmapOptions {
  /** Dimensions reported by the oriented (`imageOrientation: "from-image"`) decode. */
  orientedSize?: { width: number; height: number };
}

function installFakes({ orientedSize }: FakeBitmapOptions = {}) {
  const g = globalThis as Record<string, unknown>;

  g.createImageBitmap = (_file: unknown, options?: { imageOrientation?: string }) => {
    const oriented = options?.imageOrientation === "from-image";
    const size = oriented && orientedSize ? orientedSize : { width: WIDTH, height: HEIGHT };
    const bitmap = {
      width: size.width,
      height: size.height,
      close() {
        // Per spec, closing releases the underlying data and zeroes the dimensions.
        bitmap.width = 0;
        bitmap.height = 0;
      },
    };
    return Promise.resolve(bitmap);
  };

  g.OffscreenCanvas = class {
    constructor(
      public width: number,
      public height: number,
    ) {}
    getContext() {
      return {
        drawImage: () => {},
        getImageData: (_x: number, _y: number, w: number, h: number) => {
          if (w <= 0 || h <= 0) {
            throw new Error(`Failed to execute 'getImageData' on 'OffscreenCanvasRenderingContext2D': The source width is ${w}.`);
          }
          // Opaque mid-grey, so the RGB unpacking below has something distinguishable to check.
          const data = new Uint8ClampedArray(w * h * 4).fill(128);
          for (let i = 0; i < w * h; i++) data[i * 4 + 3] = 255;
          return { data, width: w, height: h };
        },
      };
    }
  };
}

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.createImageBitmap;
  delete g.OffscreenCanvas;
});

describe("decodeImageFile", () => {
  it("reads the bitmap's dimensions before closing it", async () => {
    installFakes();

    // Regression: this previously called bitmap.close() and *then* read bitmap.width/height for
    // getImageData, which is always 0 — so every photo failed with "The source width is 0".
    const image = await decodeImageFile({} as File);

    expect(image.width).toBe(WIDTH);
    expect(image.height).toBe(HEIGHT);
    expect(image.rgb).toHaveLength(WIDTH * HEIGHT * 3);
    expect([...image.rgb.slice(0, 3)]).toEqual([128, 128, 128]);
  });

  it("falls back to an unoriented decode when EXIF orientation yields an empty bitmap", async () => {
    // Some devices write a malformed EXIF block (an OnePlus CPH2381 used for the first real-device
    // run reported ExifImageWidth/Height of 0 and an orientation of 0, outside the spec's 1-8).
    installFakes({ orientedSize: { width: 0, height: 0 } });

    const image = await decodeImageFile({} as File);

    expect(image.width).toBe(WIDTH);
    expect(image.height).toBe(HEIGHT);
  });
});

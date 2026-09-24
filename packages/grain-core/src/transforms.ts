import type { RGBAImage } from './fingerprint.ts';

/**
 * Image transforms for fixture preparation and the robustness matrix.
 *
 * These produce images, not hashes, so they are not on the determinism-critical
 * path the way fingerprint.ts is. They still use the same area-weighted box
 * filter, so a downscale here and the one inside the fingerprint agree.
 */

/** Area-weighted box resample. Fixed iteration order, no kernel constants. */
export function resize(img: RGBAImage, width: number, height: number): RGBAImage {
  const out = new Uint8ClampedArray(width * height * 4);
  const sy = img.height / height;
  const sx = img.width / width;

  for (let oy = 0; oy < height; oy++) {
    const y0 = oy * sy, y1 = y0 + sy;
    const yStart = Math.floor(y0), yEnd = Math.min(img.height, Math.ceil(y1));
    for (let ox = 0; ox < width; ox++) {
      const x0 = ox * sx, x1 = x0 + sx;
      const xStart = Math.floor(x0), xEnd = Math.min(img.width, Math.ceil(x1));

      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let y = yStart; y < yEnd; y++) {
        const wy = Math.min(y1, y + 1) - Math.max(y0, y);
        if (wy <= 0) continue;
        for (let x = xStart; x < xEnd; x++) {
          const wx = Math.min(x1, x + 1) - Math.max(x0, x);
          if (wx <= 0) continue;
          const w = wy * wx;
          const p = (y * img.width + x) * 4;
          r += img.data[p] * w; g += img.data[p + 1] * w;
          b += img.data[p + 2] * w; a += img.data[p + 3] * w;
          wsum += w;
        }
      }
      const q = (oy * width + ox) * 4;
      if (wsum > 0) {
        out[q] = r / wsum; out[q + 1] = g / wsum; out[q + 2] = b / wsum; out[q + 3] = a / wsum;
      }
    }
  }
  return { data: out, width, height };
}

/** Scale by a factor, preserving aspect ratio. */
export function scale(img: RGBAImage, factor: number): RGBAImage {
  return resize(img, Math.max(1, Math.round(img.width * factor)), Math.max(1, Math.round(img.height * factor)));
}

/** Fit inside a square bound without upscaling. */
export function fitWithin(img: RGBAImage, maxEdge: number): RGBAImage {
  const longest = Math.max(img.width, img.height);
  if (longest <= maxEdge) return img;
  return scale(img, maxEdge / longest);
}

export function crop(img: RGBAImage, x: number, y: number, width: number, height: number): RGBAImage {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let oy = 0; oy < height; oy++) {
    const src = ((y + oy) * img.width + x) * 4;
    out.set(img.data.subarray(src, src + width * 4), oy * width * 4);
  }
  return { data: out, width, height };
}

/** Centre crop removing `fraction` of each edge -- 0.25 keeps the middle 75%. */
export function cropFraction(img: RGBAImage, fraction: number): RGBAImage {
  const w = Math.max(1, Math.round(img.width * (1 - fraction)));
  const h = Math.max(1, Math.round(img.height * (1 - fraction)));
  return crop(img, Math.floor((img.width - w) / 2), Math.floor((img.height - h) / 2), w, h);
}

/** Flatten transparency onto white. Illustrations arrive with alpha; watermarking does not. */
export function flattenOnWhite(img: RGBAImage): RGBAImage {
  const out = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3] / 255;
    out[i] = img.data[i] * a + 255 * (1 - a);
    out[i + 1] = img.data[i + 1] * a + 255 * (1 - a);
    out[i + 2] = img.data[i + 2] * a + 255 * (1 - a);
    out[i + 3] = 255;
  }
  return { data: out, width: img.width, height: img.height };
}

/** Bounding box of non-transparent content, for undoing a rasteriser's padding. */
export function contentBounds(img: RGBAImage): { x: number; y: number; width: number; height: number } {
  let minX = img.width, minY = img.height, maxX = -1, maxY = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, width: img.width, height: img.height };
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Trim a uniform border, detected from the corner pixel.
 *
 * Rasterisers pad to fit their output box -- qlmanage renders SVG onto an
 * opaque white square regardless of the artwork's aspect ratio. Alpha-based
 * bounds cannot see that padding because it is fully opaque, so the border is
 * detected by colour instead.
 *
 * `tolerance` is per-channel. Returns the input unchanged when the whole image
 * matches the corner, rather than returning nothing.
 */
export function trimUniformBorder(img: RGBAImage, tolerance = 2): RGBAImage {
  const at = (x: number, y: number) => (y * img.width + x) * 4;
  const c0 = at(0, 0);
  const bg = [img.data[c0], img.data[c0 + 1], img.data[c0 + 2]];

  const isBg = (x: number, y: number) => {
    const p = at(x, y);
    return Math.abs(img.data[p] - bg[0]) <= tolerance
      && Math.abs(img.data[p + 1] - bg[1]) <= tolerance
      && Math.abs(img.data[p + 2] - bg[2]) <= tolerance;
  };

  const rowIsBg = (y: number) => { for (let x = 0; x < img.width; x++) if (!isBg(x, y)) return false; return true; };
  const colIsBg = (x: number) => { for (let y = 0; y < img.height; y++) if (!isBg(x, y)) return false; return true; };

  let top = 0, bottom = img.height - 1, left = 0, right = img.width - 1;
  while (top < bottom && rowIsBg(top)) top++;
  while (bottom > top && rowIsBg(bottom)) bottom--;
  while (left < right && colIsBg(left)) left++;
  while (right > left && colIsBg(right)) right--;

  const width = right - left + 1;
  const height = bottom - top + 1;
  if (width <= 1 || height <= 1) return img;
  return crop(img, left, top, width, height);
}

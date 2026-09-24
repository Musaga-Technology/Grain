import jpeg from 'jpeg-js';
import { decodePNG } from './png.ts';
import type { RGBAImage } from './fingerprint.ts';

/**
 * Decode an image file to raw RGBA.
 *
 * Both codecs are pure JavaScript and run identically in Node and the browser.
 * That is the whole point: the fingerprint is only trustworthy if the pixels
 * feeding it are the same everywhere, and platform decoders do not guarantee
 * that. Browsers apply ICC colour management and premultiplied alpha through
 * canvas, and JPEG's IDCT has a legal tolerance band that different decoders
 * land in differently -- two conforming JPEG decoders can return different
 * pixels for the same file, which would silently produce different
 * fingerprints.
 *
 * Deliberately not using sharp, canvas, createImageBitmap or any native codec.
 */

export type ImageFormat = 'png' | 'jpeg';

export function sniffFormat(buf: Uint8Array): ImageFormat | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  return null;
}

export interface DecodeOptions {
  /**
   * Ceiling on decode allocation, in MB.
   *
   * This is a security control, not a tuning knob. SPEC §7 puts the resolver
   * behind no auth with open CORS, so it will decode whatever anyone posts at
   * it; a decompression bomb is a cheap way to take it down. The default is
   * deliberately modest -- a 1600px image needs about 10 MB -- and callers who
   * genuinely need more, such as offline fixture preparation over camera
   * originals, opt in explicitly.
   */
  maxMemoryMB?: number;
}

/** Enough for roughly a 45-megapixel image; well past anything served on the web. */
export const DEFAULT_MAX_DECODE_MB = 512;

export function decodeImage(buf: Uint8Array, opts: DecodeOptions = {}): RGBAImage {
  const format = sniffFormat(buf);
  if (format === 'png') return decodePNG(buf);
  if (format === 'jpeg') {
    const { width, height, data } = jpeg.decode(buf, {
      useTArray: true,
      formatAsRGBA: true,
      maxMemoryUsageInMB: opts.maxMemoryMB ?? DEFAULT_MAX_DECODE_MB,
    });
    return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width, height };
  }
  throw new Error('unsupported image format: expected PNG or JPEG');
}

/** Re-encode as JPEG at a given quality, for the robustness matrix. */
export function encodeJPEG(img: RGBAImage, quality: number): Uint8Array {
  const out = jpeg.encode({ data: img.data as unknown as Buffer, width: img.width, height: img.height }, quality);
  return new Uint8Array(out.data);
}

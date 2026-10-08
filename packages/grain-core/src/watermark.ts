/**
 * TrustMark watermark parameters.
 *
 * Adobe's official JavaScript build of TrustMark is decode-only, so the web app
 * carries its own browser port of the encoder (apps/web/app/lib/trustmark),
 * checked bit for bit against Adobe's Python reference and readable by the
 * Rust CLI.
 *
 * TrustMark payloads are not authenticated: anyone can stamp any record id onto
 * any image. That is why the forgery demo re-embeds a record id into a different
 * picture, and precisely what the fingerprint cross-check exists to catch.
 */

/**
 * BCH error-correction versions. Total payload is 100 bits, 4 of which encode
 * the version itself. Read from the Rust implementation's src/bits.rs rather
 * than from documentation.
 */
export const TRUSTMARK_VERSIONS = {
  BCH_SUPER: { dataBits: 40, eccBits: 56, correctableFlips: 8 },
  BCH_5: { dataBits: 61, eccBits: 35, correctableFlips: 5 },
  BCH_4: { dataBits: 68, eccBits: 28, correctableFlips: 4 },
  BCH_3: { dataBits: 75, eccBits: 21, correctableFlips: 3 },
} as const;

/**
 * BCH_5, chosen for interoperability over raw robustness.
 *
 * BCH_SUPER corrects more flips, but Adobe's three TrustMark implementations
 * disagree on its parity: the Rust crate pads 40 data bits to 6 bytes where the
 * Python reference uses 5, and drops a `pidx += 1` in the leftover-byte loop.
 * Python and JS agree with each other and the Rust crate cannot read their
 * BCH_SUPER marks. BCH_5's 61 bits fill 8 bytes exactly, leaving nothing over,
 * so every implementation agrees -- and the robustness matrix was measured with
 * BCH_5, so its numbers describe exactly what ships.
 */
export const TRUSTMARK_VERSION = 'BCH_5';

/** Variant Q -- PSNR 43-45 dB, the robustness/invisibility balance. */
export const TRUSTMARK_VARIANT = 'Q';

/** C2PA approved soft binding algorithm list identifier for com.adobe.trustmark.Q. */
export const TRUSTMARK_ALG_ID = 4;

/**
 * Largest recordId a watermark can carry: 2^40 - 1, about 1.1 trillion.
 *
 * BCH_5 has 61 data bits, but Grain writes its recordId into the leading 40
 * and zeros after, so a decoder can tell a Grain mark from any other TrustMark
 * payload. The registry's recordId is a uint64 on chain; only 40 bits of it fit. Registration must refuse to issue a watermark above this
 * -- the record would still resolve by fingerprint, but silently shipping an
 * unwatermarkable id would break the watermark path without any error.
 */
export const MAX_RECORD_ID = (1n << 40n) - 1n;

export function isWatermarkable(recordId: bigint): boolean {
  return recordId > 0n && recordId <= MAX_RECORD_ID;
}

/** Aspect ratios beyond this degrade the mark: TrustMark centre-crops to square. */
export const MAX_ASPECT_RATIO = 2.0;

export function aspectRatioWarning(width: number, height: number): boolean {
  const r = width > height ? width / height : height / width;
  return r > MAX_ASPECT_RATIO;
}

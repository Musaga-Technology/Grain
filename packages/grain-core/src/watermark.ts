/**
 * TrustMark watermark parameters (SPEC.md 5.2).
 *
 * IMPLEMENTATION SPLIT -- this is a correction to SPEC.md 5.2, which declares
 * embed() and decode() as if both run in the browser. They cannot:
 *
 *   decode  -> TrustMark's JS/ONNX build. This is the verify path, and decoding
 *              is the only operation that build supports.
 *   encode  -> TrustMark's Rust crate. The official JavaScript implementation
 *              is DECODE-ONLY (see adobe/trustmark README, /js), so embedding
 *              cannot happen client-side with the shipped library.
 *
 * Watermark removal is not implemented in Rust either, which is why the Act 3
 * demo re-embeds a recordId into a different image rather than lifting a mark
 * off a registered one. That is the more honest attack in any case: TrustMark
 * payloads are not authenticated, so anyone can forge one -- which is precisely
 * what the fingerprint cross-check exists to catch.
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
 * BCH_SUPER is chosen deliberately. It has the smallest payload and the
 * strongest error correction, and since a recordId needs nowhere near 40 bits
 * at any plausible scale, robustness is the scarce resource and capacity is not.
 */
export const TRUSTMARK_VERSION = 'BCH_SUPER';

/** Variant Q per SPEC.md 5.2 -- PSNR 43-45 dB, the robustness/invisibility balance. */
export const TRUSTMARK_VARIANT = 'Q';

/** C2PA approved soft binding algorithm list identifier for com.adobe.trustmark.Q. */
export const TRUSTMARK_ALG_ID = 4;

/**
 * Largest recordId a watermark can carry: 2^40 - 1, about 1.1 trillion.
 *
 * The registry's recordId is a uint64 on chain, but only the low 40 bits fit in
 * a BCH_SUPER payload. Registration must refuse to issue a watermark above this
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

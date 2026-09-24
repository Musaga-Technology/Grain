import { hammingDistance, MATCH_THRESHOLD, TAMPER_THRESHOLD } from './fingerprint.ts';
import type { GrainManifest } from './manifest.ts';

/**
 * The resolution state machine (SPEC.md §7 and §8.3).
 *
 * Pure logic, deliberately separated from the HTTP layer so it can be tested
 * exhaustively without a chain, an indexer or a network. The four states each
 * get a distinct UI treatment, so getting the boundaries right matters more
 * than almost anything else in the product.
 */

export interface ResolvedRecord {
  recordId: bigint;
  creator: `0x${string}`;
  creatorHandle?: string;
  fingerprint: bigint;
  registeredAt: number;
  blockNumber?: number;
  supersededBy?: bigint | null;
  revoked: boolean;
  manifest?: GrainManifest;
}

export type Resolution =
  | { state: 'RESOLVED'; record: ResolvedRecord; via: 'watermark' | 'fingerprint' | 'both'; distance: number }
  | { state: 'UNCERTAIN'; candidates: ResolvedRecord[]; distance: number }
  | { state: 'TAMPERED'; claimed: ResolvedRecord; distance: number }
  | { state: 'NOT_FOUND' };

export interface ResolveInput {
  /** Fingerprint of the asset as received. */
  queryFingerprint: bigint;
  /** Record the watermark pointed at, if one decoded and the id existed. */
  watermarkRecord?: ResolvedRecord | null;
  /** Candidates from the LSH fan-out, in any order. */
  candidates: ResolvedRecord[];
}

/**
 * Rank by distance, then by registration order.
 *
 * Ties break toward the earliest registration because the registry deliberately
 * does not deduplicate by fingerprint (SPEC.md §6.2): two creators may register
 * visually similar images, and the chain's own ordering is the only neutral
 * arbiter available. The UI shows the earliest.
 */
function rank(candidates: ResolvedRecord[], query: bigint): { record: ResolvedRecord; distance: number }[] {
  return candidates
    .filter((c) => !c.revoked)
    .map((record) => ({ record, distance: hammingDistance(record.fingerprint, query) }))
    .sort((a, b) =>
      a.distance !== b.distance ? a.distance - b.distance : a.record.registeredAt - b.record.registeredAt);
}

export function resolve({ queryFingerprint, watermarkRecord, candidates }: ResolveInput): Resolution {
  const ranked = rank(candidates, queryFingerprint);
  const best = ranked[0];

  if (watermarkRecord && !watermarkRecord.revoked) {
    // THE ANTI-SPOOF CROSS-CHECK (SPEC.md §2). A watermark payload is not
    // authenticated -- anyone can embed any recordId into any image. What makes
    // the claim checkable is the fingerprint stored in the manifest: if the
    // mark says one thing and the picture says another, the mark was
    // transferred and we refuse rather than attribute someone else's work.
    const claimedDistance = hammingDistance(watermarkRecord.fingerprint, queryFingerprint);

    if (claimedDistance > TAMPER_THRESHOLD) {
      return { state: 'TAMPERED', claimed: watermarkRecord, distance: claimedDistance };
    }

    // Both paths agreeing is worth saying out loud in the UI: the honest mix
    // is more convincing than a claimed 100%.
    const fingerprintAgrees = best !== undefined
      && best.record.recordId === watermarkRecord.recordId
      && best.distance <= MATCH_THRESHOLD;

    return {
      state: 'RESOLVED',
      record: watermarkRecord,
      via: fingerprintAgrees ? 'both' : 'watermark',
      distance: claimedDistance,
    };
  }

  if (best === undefined) return { state: 'NOT_FOUND' };

  if (best.distance <= MATCH_THRESHOLD) {
    return { state: 'RESOLVED', record: best.record, via: 'fingerprint', distance: best.distance };
  }

  if (best.distance <= TAMPER_THRESHOLD) {
    // Heavily edited but plausibly the same image. Surfaced as a match with a
    // caveat, never as a percentage -- "close but not exact" is honest and
    // unarguable, and a number invites a fight you cannot win live.
    //
    // Note the index only guarantees recall to MATCH_THRESHOLD, so reaching
    // this state via the fingerprint path is best-effort rather than complete.
    const near = ranked.filter((r) => r.distance <= TAMPER_THRESHOLD);
    return { state: 'UNCERTAIN', candidates: near.map((r) => r.record), distance: best.distance };
  }

  // Most images on earth are unregistered. That is the starting condition, not
  // a failure, and the UI must not style it as one.
  return { state: 'NOT_FOUND' };
}

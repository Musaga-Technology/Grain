import type { Resolution, ResolvedRecord } from '../../../../packages/grain-core/src/index.ts';
import { SITE, type Verification } from './grain.ts';

export const who = (r: { creatorHandle?: string; creator: string }) => (r.creatorHandle ? `@${r.creatorHandle}` : r.creator);
export const recordUrl = (id: bigint | string) => `${SITE}/r/${id}`;

/** One JSON-safe record, for --json output and agents. */
export function recordJson(r: ResolvedRecord) {
  return {
    recordId: r.recordId.toString(),
    creator: r.creator,
    creatorHandle: r.creatorHandle ?? null,
    registeredAt: new Date(r.registeredAt * 1000).toISOString(),
    revoked: r.revoked,
    supersededBy: r.supersededBy ? r.supersededBy.toString() : null,
    url: recordUrl(r.recordId),
  };
}

export type VerifyResult = {
  state: Resolution['state'];
  /** One plain sentence: what an agent should tell its user. */
  summary: string;
  record: ReturnType<typeof recordJson> | null;
  matchedBy: 'watermark' | 'fingerprint' | 'both' | null;
  distance: number | null;
  onChainDistance: number | null;
  fingerprint: string;
  watermark: Verification['watermark'];
  candidatesFrom: Verification['candidatesFrom'];
  /** As declared and signed by the creator, e.g. "AI-generated with ChatGPT". */
  madeWith: string | null;
};

export function toResult(v: Verification): VerifyResult {
  const r = v.resolution;
  const base = {
    fingerprint: `0x${v.fingerprint.toString(16).padStart(16, '0')}`,
    watermark: v.watermark, candidatesFrom: v.candidatesFrom, onChainDistance: v.onChainDistance ?? null,
    madeWith: v.madeWith ?? null,
  };
  const made = v.madeWith ? ` ${v.madeWith[0].toUpperCase()}${v.madeWith.slice(1)}, declared by the creator.` : '';
  switch (r.state) {
    case 'RESOLVED':
      return { ...base, state: r.state, record: recordJson(r.record), matchedBy: r.via, distance: r.distance,
        summary: `Made by ${who(r.record)} (record ${r.record.recordId}), matched by ${r.via === 'both' ? 'watermark and fingerprint' : r.via}.${made}` };
    case 'UNCERTAIN':
      return { ...base, state: r.state, record: recordJson(r.candidates[0]), matchedBy: 'fingerprint', distance: r.distance,
        summary: `Probably made by ${who(r.candidates[0])} (record ${r.candidates[0].recordId}); the copy is heavily edited, so the match is close but not exact.` };
    case 'TAMPERED':
      return { ...base, state: r.state, record: recordJson(r.claimed), matchedBy: null, distance: r.distance,
        summary: `Forged credential: the image carries ${who(r.claimed)}'s watermark, but the picture does not match what they registered. Do not attribute it to them.` };
    default:
      return { ...base, state: 'NOT_FOUND', record: null, matchedBy: null, distance: null,
        summary: 'No record: this image is not registered on Grain, or has been edited past recognition.' };
  }
}

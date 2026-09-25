export interface ResolvedRecord {
  recordId: string;
  creator: string;
  creatorHandle?: string;
  fingerprint: string;
  registeredAt: number;
  blockNumber?: number;
  supersededBy?: string | null;
  revoked: boolean;
}

/** What the resolver adds alongside the resolution itself. */
export interface ResolveExtras {
  queryFingerprint: string;
  candidatesExamined: number;
}

/** Mirrors grain-core's Resolution, serialised. No confidence field exists, deliberately. */
export type Resolution =
  | { state: 'RESOLVED'; record: ResolvedRecord; via: 'watermark' | 'fingerprint' | 'both'; distance: number }
  | { state: 'UNCERTAIN'; candidates: ResolvedRecord[]; distance: number }
  | { state: 'TAMPERED'; claimed: ResolvedRecord; distance: number }
  | { state: 'NOT_FOUND' };

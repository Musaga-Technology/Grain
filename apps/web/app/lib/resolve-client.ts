'use client';

import { createPublicClient, http, parseAbi, type PublicClient } from 'viem';
import {
  decodeImage, fingerprint, resolve, toBands,
  type Resolution, type ResolvedRecord,
} from '@grain/core';
import { CONTRACTS, monadTestnet } from './chain';

/**
 * Resolution, entirely in the browser.
 *
 * WHY NOT A SERVER. The resolver needs about 1 GB to hold the TrustMark models,
 * and the free hosts that remain cap out at 512 MB. But the fingerprint path
 * needs no models at all: grain-core is isomorphic by design, so the browser
 * computes the same fingerprint the server would, reads the chain directly, and
 * runs the same resolve(). Nothing is uploaded, so there is no request-size
 * limit and the image never leaves the person's machine.
 *
 * The fingerprint path alone resolved screenshots, JPEG Q20, downscales, blur
 * and filters at 95-100% in the robustness matrix. The watermark path, which
 * adds crops and the TAMPERED check, layers on top when the decoder is ready.
 */

const registryAbi = parseAbi([
  'function records(uint64) view returns ((address creator, uint64 fingerprint, bytes32 manifestHash, uint40 registeredAt, uint64 supersededBy, bool revoked))',
]);
const indexAbi = parseAbi([
  'function queryBand(uint8 band, uint8 value, uint256 offset, uint256 limit) view returns (uint64[])',
]);

const ZERO = '0x0000000000000000000000000000000000000000';

let client: PublicClient | null = null;
function chain(): PublicClient {
  // Batched through Multicall3: one round trip instead of one per read. On the
  // server this took candidate reads from ~10s to 0.22s; the browser benefits
  // the same way.
  client ??= createPublicClient({
    chain: monadTestnet,
    transport: http(process.env.NEXT_PUBLIC_RPC_URL),
    batch: { multicall: { wait: 8 } },
  }) as PublicClient;
  return client;
}

export async function fingerprintFile(file: File): Promise<bigint> {
  return fingerprint(decodeImage(new Uint8Array(await file.arrayBuffer())));
}

export async function readRecord(recordId: bigint): Promise<ResolvedRecord | null> {
  const r = await chain().readContract({
    address: CONTRACTS.GrainRegistry, abi: registryAbi, functionName: 'records', args: [recordId],
  });
  if (r.creator === ZERO) return null;
  return {
    recordId,
    creator: r.creator,
    fingerprint: r.fingerprint,
    registeredAt: Number(r.registeredAt),
    supersededBy: r.supersededBy === 0n ? null : r.supersededBy,
    revoked: r.revoked,
  };
}

/** The LSH fan-out: all 8 bands in parallel, unioned. */
async function candidates(fp: bigint): Promise<ResolvedRecord[]> {
  const buckets = await Promise.all(
    toBands(fp).map((value, band) =>
      chain().readContract({
        address: CONTRACTS.FingerprintIndex, abi: indexAbi, functionName: 'queryBand',
        args: [band, value, 0n, 500n],
      }).catch(() => [] as readonly bigint[])),
  );
  const ids = [...new Set(buckets.flat())];
  const records = await Promise.all(ids.map((id) => readRecord(id).catch(() => null)));
  return records.filter((r): r is ResolvedRecord => r !== null);
}

export interface LocalResolution {
  resolution: Resolution;
  queryFingerprint: bigint;
  candidatesExamined: number;
}

/**
 * @param watermarkRecordId  a recordId decoded from the image, if the
 *   watermark path found one. Omitted, this is the fingerprint path alone.
 */
export async function resolveLocally(
  file: File,
  watermarkRecordId?: bigint | null,
): Promise<LocalResolution> {
  const queryFingerprint = await fingerprintFile(file);
  const [cands, watermarkRecord] = await Promise.all([
    candidates(queryFingerprint),
    watermarkRecordId ? readRecord(watermarkRecordId) : Promise.resolve(null),
  ]);
  return {
    resolution: resolve({ queryFingerprint, watermarkRecord, candidates: cands }),
    queryFingerprint,
    candidatesExamined: cands.length,
  };
}

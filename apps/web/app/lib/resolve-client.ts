'use client';

import { createPublicClient, http, parseAbi, type PublicClient } from 'viem';
import {
  decodeCbor, decodeImage, fingerprint, hammingDistance, resolve, toBands, TAMPER_THRESHOLD,
  type GrainManifest,
  type Resolution, type ResolvedRecord,
} from '@grain/core';
import { CONTRACTS, monadTestnet } from './chain';
import { decodeWatermark, decoderReady } from './trustmark';
import { handleOf } from './creators';
import { candidatesByBands, recordById, type IndexedRecord } from './indexer';

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
  'function nextRecordId() view returns (uint64)',
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

function fromIndexed(r: IndexedRecord): ResolvedRecord {
  return {
    recordId: BigInt(r.recordId),
    creator: r.creator as `0x${string}`,
    creatorHandle: r.creatorEntity?.handle ?? undefined,
    fingerprint: BigInt(r.fingerprint),
    registeredAt: r.registeredAt,
    blockNumber: r.blockNumber,
    supersededBy: r.supersededBy ? BigInt(r.supersededBy) : null,
    revoked: r.revoked,
    manifest: decodeManifest(r.manifest),
  };
}

/**
 * The LSH fan-out. Through the indexer it is one query over the eight band
 * keys (~90 ms); if the indexer is unreachable it falls back to reading the
 * eight buckets from the chain (~1 s) -- slower, never wrong.
 */
async function candidates(fp: bigint): Promise<ResolvedRecord[]> {
  const keys = toBands(fp).map((value, band) => `${band}:${value}`);
  const indexed = await candidatesByBands(keys);
  // An index lags the chain by a few seconds. If it has nothing close, ask the
  // chain before saying so: otherwise an image registered moments ago, with its
  // watermark stripped, would read as never registered. This only costs time
  // on the not-found path; a match returns straight from the index.
  const records = indexed?.map(fromIndexed);
  if (records?.some((r) => hammingDistance(r.fingerprint, fp) <= TAMPER_THRESHOLD)) return records;
  return candidatesFromChain(fp);
}

async function candidatesFromChain(fp: bigint): Promise<ResolvedRecord[]> {
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
  watermarkFound: boolean;
}

/**
 * Both paths, in parallel, on every image -- neither is a fallback.
 * The fingerprint fan-out and the watermark decode share one decoded image and
 * race each other; resolve() then applies the anti-spoof cross-check, which is
 * what turns a transferred watermark into TAMPERED rather than a false match.
 */
export async function resolveImage(file: File): Promise<LocalResolution> {
  const img = decodeImage(new Uint8Array(await file.arrayBuffer()));
  const queryFingerprint = fingerprint(img);

  const [cands, mark] = await Promise.all([
    candidates(queryFingerprint),
    decodeWatermark(img),
  ]);
  const watermarkRecord = mark ? await readRecord(mark.recordId).catch(() => null) : null;

  const resolution = resolve({ queryFingerprint, watermarkRecord, candidates: cands });
  await attachHandles(resolution);

  return {
    resolution,
    queryFingerprint,
    candidatesExamined: cands.length,
    watermarkFound: watermarkRecord !== null,
  };
}

export interface Update extends LocalResolution {
  /** True while the watermark check is still running and may change the answer. */
  watermarkPending: boolean;
}

/**
 * Both paths, without making a first-time visitor wait on a download.
 *
 * The fingerprint path needs no model and answers in about two seconds. The
 * watermark path needs a 45 MB decoder, which on a first visit can take
 * twenty seconds or more to arrive. So when the decoder is already loaded this
 * waits for both, exactly like resolveImage; when it is not, it reports the
 * fingerprint answer at once, marked pending, and reports again when the
 * watermark lands.
 *
 * The second answer can differ from the first, and that is the point. An
 * unregistered image carrying someone else's mark reads "no record" by content
 * and TAMPERED once the mark is decoded. Saying the check is still running is
 * honest; holding the page for twenty seconds is not acceptable at the front
 * door.
 */
export async function resolveProgressive(file: File, onUpdate: (u: Update) => void): Promise<void> {
  const img = decodeImage(new Uint8Array(await file.arrayBuffer()));
  const queryFingerprint = fingerprint(img);
  const warm = decoderReady();
  const markP = decodeWatermark(img);
  const cands = await candidates(queryFingerprint);

  const settle = async (mark: Awaited<typeof markP> | null, pending: boolean) => {
    const watermarkRecord = mark ? await readRecord(mark.recordId).catch(() => null) : null;
    const resolution = resolve({ queryFingerprint, watermarkRecord, candidates: cands });
    await attachHandles(resolution);
    onUpdate({ resolution, queryFingerprint, candidatesExamined: cands.length,
               watermarkFound: watermarkRecord !== null, watermarkPending: pending });
  };

  if (warm) return settle(await markP, false);

  // Give a decoder that is nearly there a moment before answering without it.
  const quick = await Promise.race([markP.then((m) => ({ m })), new Promise<null>((r) => setTimeout(() => r(null), 2500))]);
  if (quick) return settle(quick.m, false);

  await settle(null, true);
  await settle(await markP, false);
}

export async function nextRecordId(): Promise<bigint> {
  return chain().readContract({
    address: CONTRACTS.GrainRegistry, abi: registryAbi, functionName: 'nextRecordId',
  });
}

/** Name the human, not the address. */
async function attachHandles(r: Resolution): Promise<void> {
  const records: ResolvedRecord[] =
    r.state === 'RESOLVED' ? [r.record]
    : r.state === 'TAMPERED' ? [r.claimed]
    : r.state === 'UNCERTAIN' ? r.candidates.slice(0, 1)
    : [];
  await Promise.all(records.map(async (rec) => {
    rec.creatorHandle ??= await handleOf(rec.creator);
    // The manifest says how the image was made (e.g. AI-generated). Records
    // found by watermark come from chain storage, which holds only its hash,
    // so the manifest itself is read from the indexer.
    if (!rec.manifest) {
      const indexed = await recordById(rec.recordId.toString()).catch(() => null);
      rec.manifest = decodeManifest(indexed?.manifest);
    }
  }));
}

function decodeManifest(hex: string | undefined): GrainManifest | undefined {
  if (!hex) return undefined;
  try {
    return decodeCbor(new Uint8Array((hex.slice(2).match(/../g) ?? []).map((b) => parseInt(b, 16)))) as unknown as GrainManifest;
  } catch {
    return undefined;
  }
}

/**
 * Grain, from Node: the same resolution the website runs, for agents.
 *
 * The registry lives on Monad testnet. Reads go to the Envio indexer first and
 * fall back to the chain, exactly as the web app does (README, "How Envio
 * powers Grain"); the verdict logic is grain-core's, unchanged, so a CLI answer
 * and a website answer for the same image cannot disagree.
 */
import { createPublicClient, defineChain, http, parseAbi, type PublicClient } from 'viem';
import {
  decodeCbor, decodeImage, fingerprint, hammingDistance, resolve, toBands, TAMPER_THRESHOLD,
  type Resolution, type ResolvedRecord,
} from '../../../../packages/grain-core/src/index.ts';
import deployments from '../../../../deployments/monad-testnet.json' with { type: 'json' };

export const SITE = process.env.GRAIN_SITE ?? 'https://grain-on-monad.vercel.app';
const RPC = process.env.GRAIN_RPC_URL ?? 'https://testnet-rpc.monad.xyz';
const INDEXER = process.env.GRAIN_INDEXER_URL ?? 'https://indexer.dev.hyperindex.xyz/99250c3/v1/graphql';

export const REGISTRY_CHAIN_ID = deployments.chainId;
const C = deployments.contracts as Record<'GrainRegistry' | 'FingerprintIndex' | 'CreatorRegistry' | 'LicenseRegistry', `0x${string}`>;
export const LICENSE_REGISTRY = C.LicenseRegistry;

const chain = defineChain({
  id: deployments.chainId,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
});
let client: PublicClient | undefined;
const rpc = () => (client ??= createPublicClient({ chain, transport: http(RPC), batch: { multicall: true } }) as PublicClient);
/** The Monad testnet client, for callers outside this module (gas and fees for submissions). */
export const registryClient = () => rpc();

const registryAbi = parseAbi([
  'function records(uint64) view returns ((address creator, uint64 fingerprint, bytes32 manifestHash, uint40 registeredAt, uint64 supersededBy, bool revoked))',
]);
const indexAbi = parseAbi([
  'function queryBand(uint8 band, uint8 value, uint256 offset, uint256 limit) view returns (uint64[])',
  'function verify(uint64 recordId, uint64 queryFingerprint) view returns (uint8)',
]);
const creatorAbi = parseAbi([
  'function creators(address) view returns ((string handle, string profileURI, uint256 licensePriceWei))',
]);
export const licenceAbi = parseAbi([
  'function license(uint64 recordId) payable',
  'function priceOf(uint64 recordId) view returns (uint256)',
  'function hasLicense(uint64 recordId, address licensee) view returns (bool)',
]);
const ZERO = '0x0000000000000000000000000000000000000000';

// ------------------------------------------------------------------ indexer --

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const res = await fetch(INDEXER, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: T; errors?: unknown };
    return body.errors ? null : (body.data ?? null);
  } catch {
    return null;
  }
}

interface IndexedRecord {
  recordId: string; creator: string; fingerprint: string; registeredAt: number;
  blockNumber: number; txHash: string; revoked: boolean; supersededBy: string | null;
  creatorEntity?: { handle: string | null } | null;
}
const FIELDS = 'recordId creator fingerprint registeredAt blockNumber txHash revoked supersededBy creatorEntity { handle }';

function fromIndexed(r: IndexedRecord): ResolvedRecord {
  return {
    recordId: BigInt(r.recordId), creator: r.creator as `0x${string}`,
    creatorHandle: r.creatorEntity?.handle ?? undefined, fingerprint: BigInt(r.fingerprint),
    registeredAt: r.registeredAt, blockNumber: r.blockNumber,
    supersededBy: r.supersededBy ? BigInt(r.supersededBy) : null, revoked: r.revoked,
  };
}

// -------------------------------------------------------------------- reads --

export async function readRecord(recordId: bigint): Promise<ResolvedRecord | null> {
  const r = await rpc().readContract({ address: C.GrainRegistry, abi: registryAbi, functionName: 'records', args: [recordId] });
  if (r.creator === ZERO) return null;
  return {
    recordId, creator: r.creator, fingerprint: r.fingerprint, registeredAt: Number(r.registeredAt),
    supersededBy: r.supersededBy === 0n ? null : r.supersededBy, revoked: r.revoked,
  };
}

export async function handleOf(address: string): Promise<string | undefined> {
  try {
    const c = await rpc().readContract({ address: C.CreatorRegistry, abi: creatorAbi, functionName: 'creators', args: [address as `0x${string}`] });
    return c.handle || undefined;
  } catch {
    return undefined;
  }
}

async function candidatesFromChain(fp: bigint): Promise<ResolvedRecord[]> {
  const buckets = await Promise.all(toBands(fp).map((value, band) =>
    rpc().readContract({ address: C.FingerprintIndex, abi: indexAbi, functionName: 'queryBand', args: [band, value, 0n, 500n] })
      .catch(() => [] as readonly bigint[])));
  const ids = [...new Set(buckets.flat())];
  return (await Promise.all(ids.map((id) => readRecord(id).catch(() => null)))).filter((r): r is ResolvedRecord => r !== null);
}

/** Indexer first; the chain when it is down, or has nothing close (it may lag). */
async function candidates(fp: bigint): Promise<{ records: ResolvedRecord[]; source: 'indexer' | 'chain' }> {
  const keys = toBands(fp).map((value, band) => `${band}:${value}`);
  const data = await gql<{ FingerprintBand: { record: IndexedRecord }[] }>(
    `query($keys:[String!]!){ FingerprintBand(where:{key:{_in:$keys}, revoked:{_eq:false}}){ record { ${FIELDS} } } }`, { keys });
  if (data) {
    const seen = new Map<string, ResolvedRecord>();
    for (const b of data.FingerprintBand) seen.set(b.record.recordId, fromIndexed(b.record));
    const records = [...seen.values()];
    if (records.some((r) => hammingDistance(r.fingerprint, fp) <= TAMPER_THRESHOLD)) return { records, source: 'indexer' };
  }
  return { records: await candidatesFromChain(fp), source: 'chain' };
}

/** The contract's own distance between a record and an image: no indexer involved. */
export async function verifyOnChain(recordId: bigint, fp: bigint): Promise<number> {
  return Number(await rpc().readContract({ address: C.FingerprintIndex, abi: indexAbi, functionName: 'verify', args: [recordId, fp] }));
}

// ------------------------------------------------------------------ resolve --

export interface Verification {
  resolution: Resolution;
  fingerprint: bigint;
  watermark: 'found' | 'none' | 'skipped';
  candidatesFrom: 'indexer' | 'chain';
  /** The distance FingerprintIndex.verify() returned, when there is a record to check. */
  onChainDistance?: number;
  /** How the record's image was made, as declared by its creator. */
  madeWith?: string | null;
}

export async function verifyImage(
  bytes: Uint8Array,
  decodeWatermark: ((img: ReturnType<typeof decodeImage>) => Promise<{ recordId: bigint } | null>) | null,
): Promise<Verification> {
  const img = decodeImage(bytes);
  const fp = fingerprint(img);
  const [cands, mark] = await Promise.all([candidates(fp), decodeWatermark ? decodeWatermark(img) : Promise.resolve(null)]);
  const watermarkRecord = mark ? await readRecord(mark.recordId).catch(() => null) : null;
  const resolution = resolve({ queryFingerprint: fp, watermarkRecord, candidates: cands.records });

  const subject = resolution.state === 'RESOLVED' ? resolution.record
    : resolution.state === 'TAMPERED' ? resolution.claimed
    : resolution.state === 'UNCERTAIN' ? resolution.candidates[0] : undefined;
  if (subject) subject.creatorHandle ??= await handleOf(subject.creator);

  const made = subject ? await madeWith(subject.recordId) : null;
  return {
    resolution, fingerprint: fp, madeWith: made,
    watermark: decodeWatermark ? (watermarkRecord ? 'found' : 'none') : 'skipped',
    candidatesFrom: cands.source,
    onChainDistance: subject ? await verifyOnChain(subject.recordId, fp).catch(() => undefined) : undefined,
  };
}

// ---------------------------------------------------------------- listings --

export interface CreatorListing {
  address: string; handle: string; recordCount: number;
  records: { recordId: string; registeredAt: string; blockNumber: number; txHash: string }[];
}

/** Only the indexer can answer this: the contracts cannot list a creator's records. */
export async function creatorByHandle(handle: string): Promise<CreatorListing | null | 'unavailable'> {
  type Row = { recordId: string; registeredAt: number; blockNumber: number; txHash: string };
  const data = await gql<{ Creator: { id: string; handle: string; recordCount: number; records: Row[] }[] }>(
    `query($h:String!){ Creator(where:{handle:{_eq:$h}}){ id handle recordCount
       records(order_by:{recordId:desc}, limit:50){ recordId registeredAt blockNumber txHash } } }`, { h: handle });
  if (data === null) return 'unavailable';
  const c = data.Creator[0];
  if (!c) return null;
  const records = c.records.map((r) => ({ ...r, registeredAt: new Date(r.registeredAt * 1000).toISOString() }));
  return { address: c.id, handle: c.handle, recordCount: c.recordCount, records };
}

/** The creator's current licence price for a record, from the contract. 0 means not licensable. */
export async function licencePrice(recordId: bigint): Promise<bigint> {
  return rpc().readContract({ address: C.LicenseRegistry, abi: licenceAbi, functionName: 'priceOf', args: [recordId] });
}

/** Licences granted for a record, newest first. Only the indexer keeps the list. */
export async function licencesFor(recordId: bigint): Promise<{ licensee: string; amountWei: string; grantedAt: number; txHash: string }[] | null> {
  const data = await gql<{ License: { licensee: string; amountWei: string; grantedAt: number; txHash: string }[] }>(
    `query($id:numeric!){ License(where:{recordId:{_eq:$id}}, order_by:{grantedAt:desc}){ licensee amountWei grantedAt txHash } }`,
    { id: recordId.toString() });
  return data?.License ?? null;
}

/**
 * How a record's image was made, as its creator declared and signed it
 * (C2PA digitalSourceType): "AI-generated with ChatGPT", "photograph", ...
 * null when the manifest says nothing or the indexer can't be reached.
 */
export async function madeWith(recordId: bigint): Promise<string | null> {
  const data = await gql<{ Record: { manifest: string }[] }>(
    `query($id:String!){ Record(where:{id:{_eq:$id}}){ manifest } }`, { id: recordId.toString() });
  const hex = data?.Record[0]?.manifest;
  if (!hex) return null;
  try {
    const m = decodeCbor(new Uint8Array((hex.slice(2).match(/../g) ?? []).map((b) => parseInt(b, 16)))) as
      { assertions?: { created?: { digitalSourceType?: string; softwareAgent?: string } } };
    const c = m.assertions?.created;
    const kind = c?.digitalSourceType?.split('/').pop();
    if (kind === 'trainedAlgorithmicMedia') return `AI-generated${c?.softwareAgent ? ` with ${c.softwareAgent}` : ''}`;
    if (kind === 'digitalCapture') return 'photograph';
    if (kind === 'digitalCreation') return 'artwork made by a person';
    return null;
  } catch {
    return null;
  }
}

export async function indexedRecord(recordId: bigint): Promise<{ blockNumber: number; txHash: string } | null> {
  const data = await gql<{ Record: { blockNumber: number; txHash: string }[] }>(
    `query($id:String!){ Record(where:{id:{_eq:$id}}){ blockNumber txHash } }`, { id: recordId.toString() });
  return data?.Record[0] ?? null;
}

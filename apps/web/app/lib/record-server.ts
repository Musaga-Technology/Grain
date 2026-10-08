import 'server-only';
import { unstable_cache } from 'next/cache';
import { createPublicClient, http, keccak256, parseAbi, parseAbiItem, type Hex } from 'viem';
import { decodeCbor, verifyManifest, type GrainManifest } from '@grain/core';
import { CONTRACTS, creatorAbi } from './chain';
import { licencesFor, recordById } from './indexer';
import deployments from '../../../../deployments/monad-testnet.json';

/**
 * Everything a shared record page shows, read from the chain.
 *
 * The manifest exists only in event data -- storage holds its hash, which is
 * what makes per-asset registration cheap. Public RPCs cap log queries at 100
 * blocks, so the registration block is located first from the record's own
 * timestamp, then queried narrowly.
 */

const client = createPublicClient({ transport: http(process.env.NEXT_PUBLIC_RPC_URL) });
const DEPLOY_BLOCK = 65176523n;

const registryAbi = parseAbi([
  'function records(uint64) view returns ((address creator, uint64 fingerprint, bytes32 manifestHash, uint40 registeredAt, uint64 supersededBy, bool revoked))',
]);
const registered = parseAbiItem(
  'event ManifestRegistered(uint64 indexed recordId, address indexed creator, uint64 fingerprint, bytes32 manifestHash, bytes manifest)',
);

async function timestampOf(block: bigint): Promise<number> {
  return Number((await client.getBlock({ blockNumber: block })).timestamp);
}

/** The deployment block never moves, so neither does its timestamp. */
const DEPLOY_TS = 1790216098;
/** A log query may span at most 100 blocks on the public RPC. */
const LOG_SPAN = 100n;

/**
 * A window of fewer than 100 blocks that contains the block stamped `ts`.
 *
 * Interpolation from the chain's own block rate, stopping as soon as the
 * window fits one log query rather than narrowing to a single block: each
 * lookup costs ~0.8s on the public RPC, so every call saved is visible.
 */
async function windowAt(ts: number): Promise<{ from: bigint; to: bigint }> {
  let lo = DEPLOY_BLOCK, loTs = DEPLOY_TS;
  let hi = await client.getBlockNumber();
  let hiTs = await timestampOf(hi);
  for (let i = 0; i < 12 && hi - lo > LOG_SPAN - 1n; i++) {
    const span = Number(hi - lo);
    const frac = hiTs === loTs ? 0.5 : (ts - loTs) / (hiTs - loTs);
    const guess = lo + BigInt(Math.min(span - 1, Math.max(1, Math.round(span * frac))));
    const guessTs = await timestampOf(guess);
    // Several blocks share each second, so step the far bound past the guess
    // by a margin rather than onto it; that lands the window in a few calls.
    if (guessTs < ts) { lo = guess; loTs = guessTs; } else { hi = guess; hiTs = guessTs; }
  }
  return { from: lo, to: lo + LOG_SPAN - 1n };
}

export interface RecordView {
  recordId: string;
  creator: Hex;
  handle?: string;
  fingerprint: string;
  registeredAt: number;
  supersededBy: string | null;
  revoked: boolean;
  blockNumber?: string;
  txHash?: Hex;
  title?: string;
  generator?: string;
  watermarked?: boolean;
  /** The logged manifest hashes to what the contract stored. */
  manifestMatchesChain?: boolean;
  /** The manifest's signature recovers to the record's creator. */
  signatureValid?: boolean;
  /** Recorded, but not in Grain's manifest format. */
  manifestUnreadable?: boolean;
  /** Where the manifest was found: the indexer, or a log search on chain. */
  source?: 'indexer' | 'chain';
  manifest?: Record<string, unknown>;
}

async function load(recordId: string): Promise<RecordView | null> {
  const id = BigInt(recordId);
  const r = await client.readContract({
    address: CONTRACTS.GrainRegistry, abi: registryAbi, functionName: 'records', args: [id],
  });
  if (r.creator === '0x0000000000000000000000000000000000000000') return null;

  const profile = await client.readContract({
    address: CONTRACTS.CreatorRegistry, abi: creatorAbi, functionName: 'creators', args: [r.creator],
  }).catch(() => null);

  const view: RecordView = {
    recordId,
    creator: r.creator,
    handle: profile?.handle || undefined,
    fingerprint: `0x${r.fingerprint.toString(16).padStart(16, '0')}`,
    registeredAt: Number(r.registeredAt),
    supersededBy: r.supersededBy === 0n ? null : r.supersededBy.toString(),
    revoked: r.revoked,
  };

  try {
    // The indexer answers in one query. It is not trusted for it: the manifest
    // it returns is hashed and compared against the hash the contract holds, so
    // a wrong or stale index cannot pass off a different manifest.
    let manifestHex: Hex | undefined;
    const indexed = await recordById(recordId);
    if (indexed?.manifest) {
      manifestHex = indexed.manifest as Hex;
      view.blockNumber = String(indexed.blockNumber);
      view.txHash = indexed.txHash as Hex;
      view.source = 'indexer';
    } else {
      const { from, to } = await windowAt(Number(r.registeredAt));
      const logs = await client.getLogs({
        address: CONTRACTS.GrainRegistry, event: registered, args: { recordId: id }, fromBlock: from, toBlock: to,
      });
      const log = logs[0];
      if (log?.args.manifest) {
        manifestHex = log.args.manifest;
        view.blockNumber = log.blockNumber?.toString();
        view.txHash = log.transactionHash ?? undefined;
        view.source = 'chain';
      }
    }
    if (manifestHex) {
      view.manifestMatchesChain = keccak256(manifestHex) === r.manifestHash;

      let m: Record<string, any>;
      try {
        m = decodeCbor(new Uint8Array(Buffer.from(manifestHex.slice(2), 'hex'))) as Record<string, any>;
      } catch {
        // The registry accepts any bytes; it is the reader that interprets
        // them. Say so plainly rather than drop the section.
        view.manifestUnreadable = true;
        return view;
      }
      const bindings: Array<{ alg: string }> = m.assertions?.softBindings ?? [];
      view.title = m.assertions?.title;
      view.generator = m.assertions?.generator;
      view.watermarked = bindings.some((b) => b.alg === 'com.adobe.trustmark.Q');
      view.signatureValid = (await verifyManifest(m as GrainManifest))
        && String(m.creator).toLowerCase() === r.creator.toLowerCase();
      view.manifest = JSON.parse(JSON.stringify(m, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
    }
  } catch (e) {
    // The record itself came from storage and stands on its own; the manifest
    // is enrichment. Show what we have rather than fail the page.
    console.warn(`record ${recordId}: could not load the manifest`, e);
  }
  return view;
}

/**
 * A registration's block, transaction and manifest never change, so they are
 * cached for an hour. supersededBy and revoked can change, which is why this is
 * not cached forever.
 */
export const loadRecord = (recordId: string) =>
  unstable_cache(() => load(recordId), ['record', recordId, deployments.contracts.GrainRegistry], { revalidate: 3600 })();

/**
 * Licensing, kept out of loadRecord's hour-long cache: a creator can change
 * their price and licences accrue, so this is read fresh with the page. The
 * price comes from the contract; only the count of licences needs the indexer.
 */
export async function loadLicensing(creator: Hex, recordId: string): Promise<{ priceWei: bigint; licences?: number }> {
  const [profile, licences] = await Promise.all([
    client.readContract({ address: CONTRACTS.CreatorRegistry, abi: creatorAbi, functionName: 'creators', args: [creator] })
      .catch(() => null),
    licencesFor(recordId),
  ]);
  return { priceWei: profile?.licensePriceWei ?? 0n, licences: licences?.length };
}

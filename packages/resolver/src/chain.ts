import { createPublicClient, http, parseAbi, type Hex, type PublicClient } from 'viem';
import { toBands, type ResolvedRecord } from '@grain/core';

/**
 * Chain reads.
 *
 * SPEC §7 makes the indexer a read accelerator, not the source of truth: the
 * product must work with Envio down, and demonstrating that fallback live is a
 * better moment than a rehearsed one. So this path is built first and stays
 * the one that is always correct.
 */

export const registryAbi = parseAbi([
  'function records(uint64) view returns ((address creator, uint64 fingerprint, bytes32 manifestHash, uint40 registeredAt, uint64 supersededBy, bool revoked))',
  'function nextRecordId() view returns (uint64)',
]);

export const indexAbi = parseAbi([
  'function queryBand(uint8 band, uint8 value, uint256 offset, uint256 limit) view returns (uint64[])',
  'function bandSize(uint8 band, uint8 value) view returns (uint256)',
  'function verify(uint64 recordId, uint64 queryFingerprint) view returns (uint8)',
]);

export interface ChainConfig {
  rpcUrl: string;
  registry: Hex;
  index: Hex;
  /** Cap on ids pulled from one bucket. The tail is ~5x the mean (docs/GAS.md). */
  bucketLimit?: bigint;
  /** Multicall3, deployed at the canonical address on Monad testnet. */
  multicall?: Hex;
}

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const;

export class Chain {
  private client: PublicClient;
  private cfg: ChainConfig;

  constructor(cfg: ChainConfig) {
    this.cfg = cfg;
    this.client = createPublicClient({
      transport: http(cfg.rpcUrl),
      // Batching collapses the candidate fan-out from one RPC round trip per
      // record into a single call. Measured on a 506-record registry, a resolve
      // reading 34 candidates went from ~11.6s to well under a second: the
      // latency was never the chain, it was the round trips.
      batch: { multicall: { wait: 8 } },
      chain: {
        id: 0, name: 'grain-target',
        nativeCurrency: { name: 'native', symbol: 'NATIVE', decimals: 18 },
        rpcUrls: { default: { http: [cfg.rpcUrl] } },
        contracts: { multicall3: { address: cfg.multicall ?? MULTICALL3 } },
      },
    }) as PublicClient;
  }

  async record(recordId: bigint): Promise<ResolvedRecord | null> {
    const r = await this.client.readContract({
      address: this.cfg.registry, abi: registryAbi, functionName: 'records', args: [recordId],
    });
    if (r.creator === '0x0000000000000000000000000000000000000000') return null;
    return {
      recordId,
      creator: r.creator,
      fingerprint: r.fingerprint,
      registeredAt: Number(r.registeredAt),
      supersededBy: r.supersededBy === 0n ? null : r.supersededBy,
      revoked: r.revoked,
    };
  }

  /**
   * LSH fan-out: read all 8 bands and union the ids.
   *
   * Eight reads rather than one GraphQL query is exactly the cost the indexer
   * exists to remove. It is also why the index is a read accelerator and not a
   * dependency -- this works without it, just slower.
   */
  async candidates(fingerprint: bigint): Promise<bigint[]> {
    const bands = toBands(fingerprint);
    const limit = this.cfg.bucketLimit ?? 500n;

    const buckets = await Promise.all(
      bands.map((value, band) =>
        this.client.readContract({
          address: this.cfg.index, abi: indexAbi, functionName: 'queryBand',
          args: [band, value, 0n, limit],
        }).catch(() => [] as readonly bigint[])),
    );

    const ids = new Set<bigint>();
    for (const bucket of buckets) for (const id of bucket) ids.add(id);
    return [...ids];
  }

  /**
   * Read many records at once.
   *
   * Issued concurrently so viem's multicall batching folds them into a single
   * aggregate call rather than one request per candidate. This is the hot path:
   * a resolve reads every candidate the LSH fan-out returned.
   */
  async records(ids: bigint[]): Promise<ResolvedRecord[]> {
    const out = await Promise.all(ids.map((id) => this.record(id).catch(() => null)));
    return out.filter((r): r is ResolvedRecord => r !== null);
  }

  /** The contract's own answer, for the UI's "verify on chain" button. */
  async verify(recordId: bigint, queryFingerprint: bigint): Promise<number> {
    return this.client.readContract({
      address: this.cfg.index, abi: indexAbi, functionName: 'verify',
      args: [recordId, queryFingerprint],
    });
  }

  async health(): Promise<{ block: bigint; nextRecordId: bigint }> {
    const [block, nextRecordId] = await Promise.all([
      this.client.getBlockNumber(),
      this.client.readContract({ address: this.cfg.registry, abi: registryAbi, functionName: 'nextRecordId' }),
    ]);
    return { block, nextRecordId };
  }
}

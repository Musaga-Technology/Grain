'use client';

import { createPublicClient, http, keccak256, toBytes, type PublicClient } from 'viem';
import { CONTRACTS, creatorAbi, monadTestnet } from './chain';

/**
 * Creator names.
 *
 * Kept in their own registry, separate from content records, because C2PA
 * deliberately does not address human identity -- it covers the provenance of
 * the content, for privacy reasons (SPEC.md §6.4). A record says which key
 * registered it; this says what that key's owner chose to be called.
 */

let client: PublicClient | null = null;
function chain(): PublicClient {
  client ??= createPublicClient({
    chain: monadTestnet,
    transport: http(process.env.NEXT_PUBLIC_RPC_URL),
    batch: { multicall: { wait: 8 } },
  }) as PublicClient;
  return client;
}

const cache = new Map<string, Promise<string | undefined>>();

export function handleOf(address: string): Promise<string | undefined> {
  const key = address.toLowerCase();
  if (!cache.has(key)) {
    cache.set(key, chain().readContract({
      address: CONTRACTS.CreatorRegistry, abi: creatorAbi, functionName: 'creators',
      args: [address as `0x${string}`],
    }).then((c) => c.handle || undefined).catch(() => undefined));
  }
  return cache.get(key)!;
}

/**
 * "Ana Ruiz" -> "ana-ruiz". The registry enforces lowercase [a-z0-9-], 3-30
 * characters, no leading or trailing hyphen, so the conversion has to land
 * inside that or the transaction reverts.
 */
export function toHandle(name: string): string | null {
  const slug = name
    .normalize('NFKD').replace(/[̀-ͯ]/g, '') // é -> e
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/, '');
  return slug.length >= 3 ? slug : null;
}

/**
 * A handle nobody else holds. If "ana-ruiz" is taken, the owner's address
 * supplies a short, stable suffix rather than a random one, so retrying
 * produces the same answer.
 */
export async function availableHandle(base: string, owner: string): Promise<string> {
  const candidates = [base, `${base.slice(0, 25)}-${owner.slice(2, 6).toLowerCase()}`];
  for (const h of candidates) {
    const holder = await chain().readContract({
      address: CONTRACTS.CreatorRegistry, abi: creatorAbi, functionName: 'handleOwner',
      args: [keccak256(toBytes(h))],
    });
    if (holder === '0x0000000000000000000000000000000000000000' || holder.toLowerCase() === owner.toLowerCase()) {
      return h;
    }
  }
  return `${base.slice(0, 21)}-${owner.slice(2, 10).toLowerCase()}`;
}

'use client';

import { handleOf } from './creators';
import type { Keyring } from './mera';

/**
 * Pen names: extra accounts from the same passkey (see lib/mera).
 *
 * The list kept here is a convenience, not the source of truth. Slot n's
 * address is derived from the passkey, and its name lives on chain, so on a
 * new device the slots are found again by asking the chain which ones have a
 * name -- nothing about pen names has to be stored or synced.
 */

const KEY = 'grain.pennames.v1';
export const MAX_PEN_NAMES = 20;

export function knownPenNames(): { n: number; handle: string }[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}

export function rememberPenName(n: number, handle: string) {
  try {
    const rest = knownPenNames().filter((p) => p.n !== n);
    localStorage.setItem(KEY, JSON.stringify([...rest, { n, handle }].sort((a, b) => a.n - b.n)));
  } catch { /* private mode: the chain still knows */ }
}

/** The slot already holding this pen name, or the first unused one. */
export async function findPenSlot(ring: Keyring, handle: string): Promise<number> {
  const known = knownPenNames().find((p) => p.handle === handle);
  if (known) return known.n;
  for (let n = 1; n <= MAX_PEN_NAMES; n++) {
    const onChain = await handleOf(ring.penName(n).account.address);
    if (!onChain || onChain === handle) return n;
  }
  throw new Error(`You already have ${MAX_PEN_NAMES} pen names.`);
}

/** Every slot with a name on chain: how "Your work" recovers pen names anywhere. */
export async function discoverPenNames(ring: Keyring): Promise<{ n: number; handle: string; address: string }[]> {
  const found: { n: number; handle: string; address: string }[] = [];
  // Stop after a run of empty slots: pen names are taken in order.
  for (let n = 1, empty = 0; n <= MAX_PEN_NAMES && empty < 3; n++) {
    const address = ring.penName(n).account.address;
    const handle = await handleOf(address);
    if (handle) { found.push({ n, handle, address }); rememberPenName(n, handle); empty = 0; } else empty++;
  }
  return found;
}

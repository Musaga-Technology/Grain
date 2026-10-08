import { createPublicClient, createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { anchorAbi, CONTRACTS, monadTestnet } from '../../lib/chain';
import { eventsInWindow } from '../../lib/activity';
import { canonicalLog, logRoot } from '../../lib/seal-format';

/**
 * Seals the activity log on Monad: every event since the last seal, up to two
 * minutes ago. Run daily by Vercel Cron, and on demand by whoever holds
 * CRON_SECRET. The two minutes keep a report still being written from landing
 * inside a window that has already been sealed.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SETTLE_SECONDS = 120;

async function sealNow(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorised' }, { status: 401 });
  }
  const key = process.env.ANCHOR_PRIVATE_KEY;
  const rpc = process.env.RPC_TESTNET_ENDPOINT ?? process.env.NEXT_PUBLIC_RPC_URL;
  if (!key || !rpc) return Response.json({ error: 'sealing is not configured' }, { status: 500 });

  const transport = http(rpc);
  const pub = createPublicClient({ chain: monadTestnet, transport });
  const last = await pub.readContract({ address: CONTRACTS.ActivityAnchor, abi: anchorAbi, functionName: 'latest' });
  const until = Math.floor(Date.now() / 1000) - SETTLE_SECONDS;
  if (until <= Number(last.until)) return Response.json({ sealed: false, reason: 'nothing new to seal yet' });

  const events = await eventsInWindow(Number(last.until), until);
  const lines = canonicalLog(events).split('\n').filter(Boolean);
  const root = logRoot(lines);

  const account = privateKeyToAccount(`0x${key.replace(/^0x/, '')}` as Hex);
  const wallet = createWalletClient({ account, chain: monadTestnet, transport });
  const hash = await wallet.writeContract({
    address: CONTRACTS.ActivityAnchor, abi: anchorAbi, functionName: 'seal',
    args: [BigInt(until), events.length, root],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  return Response.json({
    sealed: receipt.status === 'success', from: Number(last.until), until, events: events.length, root, tx: hash,
  });
}

// Vercel Cron sends GET; a manual run can use either.
export const GET = sealNow;
export const POST = sealNow;

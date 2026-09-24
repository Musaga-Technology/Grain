import { createPublicClient, createWalletClient, http, parseEther, isAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/**
 * Give a new creator enough testnet MON to register.
 *
 * THE PROBLEM THIS SOLVES. SPEC §6.2 makes msg.sender the creator, and SPEC §0
 * forbids crypto vocabulary on the primary path. A passkey-derived account
 * starts with nothing, and a photographer who has never used crypto cannot fund
 * it — there is no wallet to open and no exchange to buy from.
 *
 * A relayer would break attribution: the registry would record the relayer as
 * the creator rather than the photographer. Meta-transactions would fix that
 * but need signature recovery on chain, which SPEC §6.2 explicitly rules out.
 *
 * So the app funds the account instead. On testnet this costs nothing real, it
 * keeps msg.sender correct, and it is what makes the no-wallet promise
 * deliverable rather than aspirational. On mainnet this would need rethinking,
 * and the README should say so.
 */

export const runtime = 'nodejs';

/** Enough for several registrations at the measured ~95k warm gas. */
const GRANT = parseEther('0.05');
/** Only tops up accounts that genuinely cannot transact. */
const FLOOR = parseEther('0.02');

export async function POST(req: Request) {
  const { address } = (await req.json()) as { address?: string };
  if (!address || !isAddress(address)) {
    return Response.json({ error: 'invalid address' }, { status: 400 });
  }

  const rpc = process.env.RPC_TESTNET_ENDPOINT;
  const key = process.env.PRIVATE_KEY;
  if (!rpc || !key) return Response.json({ error: 'server not configured' }, { status: 500 });

  const transport = http(rpc);
  const pub = createPublicClient({ transport });

  const balance = await pub.getBalance({ address });
  if (balance >= FLOOR) return Response.json({ funded: false, reason: 'already funded' });

  const account = privateKeyToAccount(`0x${key.replace(/^0x/, '')}` as Hex);
  const wallet = createWalletClient({ account, transport });

  const hash = await wallet.sendTransaction({
    to: address,
    value: GRANT,
    chain: null,
  });
  await pub.waitForTransactionReceipt({ hash });

  return Response.json({ funded: true, hash });
}

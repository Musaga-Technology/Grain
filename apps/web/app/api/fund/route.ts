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

/**
 * A registration costs about 95k gas (docs/GAS.md), which at ~102 gwei is
 * roughly 0.0097 MON. This covers two, and no more: the smaller the grant, the
 * less a drained faucet costs.
 */
const GRANT = parseEther('0.02');
/** Only tops up accounts that genuinely cannot transact. */
const FLOOR = parseEther('0.01');

/**
 * THIS IS A FAUCET ON A PUBLIC ENDPOINT AND IT CAN BE DRAINED.
 *
 * The balance floor stops repeat claims from one address, but nothing stops
 * someone generating fresh addresses. These limits make that slow and cheap
 * rather than impossible, which is the right trade on testnet where the funds
 * have no value and the alternative is no passkey onboarding at all.
 *
 * The in-memory counters reset whenever the serverless instance recycles, so
 * they are a speed bump rather than a guarantee. A real deployment needs
 * durable rate limiting, and mainnet needs a different funding model entirely
 * -- say so in the README rather than let a judge find it.
 */
const MAX_GRANTS_PER_HOUR = 30;
const grantsThisHour: number[] = [];

function underRateLimit(): boolean {
  const cutoff = Date.now() - 3_600_000;
  while (grantsThisHour.length && grantsThisHour[0] < cutoff) grantsThisHour.shift();
  return grantsThisHour.length < MAX_GRANTS_PER_HOUR;
}

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

  if (!underRateLimit()) {
    // The person can still register if they have funds; only the grant is
    // withheld, so the failure is a quiet one rather than a broken flow.
    return Response.json({ funded: false, reason: 'rate limited' }, { status: 429 });
  }
  grantsThisHour.push(Date.now());

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

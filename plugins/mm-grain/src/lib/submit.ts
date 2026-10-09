import { parseEther, zeroAddress } from 'viem';
import { REGISTRY_CHAIN_ID, registryClient } from './grain.ts';

/**
 * The request mm's wallet executor expects, built as mm's own
 * `wallet send-transaction` builds it: quantities as bigint, `data` left out
 * when there is none.
 *
 * On Monad testnet it also carries the gas limit and fee caps. MetaMask's
 * wallet asks MetaMask's gas-fee service for estimates, and that service
 * answers "Invalid chainId" for chain 10143 even though the wallet itself
 * supports it, so the transaction is refused before it is ever sent. mm's
 * TransactionController skips that service when maxFeePerGas and
 * maxPriorityFeePerGas are already set, so on testnet Grain reads them from
 * Monad's own RPC and fills them in. Other chains are left to MetaMask.
 *
 * Monad charges the whole gas limit, not the gas used, so the limit is an
 * estimate plus a margin rather than a round guess.
 */

/** Measured on testnet: license() 118,271, a plain transfer 21,000. Used if estimation fails. */
const FALLBACK_GAS = { call: 150_000n, transfer: 21_000n };

/**
 * What the transaction is for, in words. MetaMask shows this summary in the
 * approval it sends the wallet's owner; without it the email reads "Unknown
 * transaction". Same shape as mm's own intents: { action, summary }.
 */
export type Intent = { action: 'transfer' | 'custom'; summary: string };

export async function executorRequest(chainId: number, tx: { to: `0x${string}`; value: `0x${string}`; data: `0x${string}` }, intent?: Intent) {
  const hasData = Boolean(tx.data && tx.data !== '0x');
  const transaction: Record<string, unknown> = {
    to: tx.to,
    value: BigInt(tx.value),
    ...(hasData ? { data: tx.data } : {}),
  };

  if (chainId === REGISTRY_CHAIN_ID) {
    const rpc = registryClient();
    const [block, tip] = await Promise.all([rpc.getBlock(), rpc.estimateMaxPriorityFeePerGas()]);
    let gas: bigint;
    try {
      // Estimated from an account given enough balance by a state override,
      // since the sender's own address isn't available to a plugin command.
      const estimate = await rpc.estimateGas({
        account: zeroAddress, to: tx.to, value: BigInt(tx.value), ...(hasData ? { data: tx.data } : {}),
        stateOverride: [{ address: zeroAddress, balance: parseEther('1000000') }],
      });
      gas = hasData ? (estimate * 125n) / 100n : estimate;
    } catch {
      gas = hasData ? FALLBACK_GAS.call : FALLBACK_GAS.transfer;
    }
    const base = block.baseFeePerGas ?? 0n;
    transaction.gas = gas;
    transaction.maxPriorityFeePerGas = tip;
    transaction.maxFeePerGas = base * 2n + tip; // headroom for a base fee rise before inclusion
  }

  return { kind: 'transaction', chainId, transaction, ...(intent ? { intent } : {}) };
}

/**
 * Point MetaMask's wallet at Monad's own RPC for chain 10143.
 *
 * mm lists Monad Testnet as supported, but without an RPC of its own it routes
 * the chain through MetaMask's Infura proxy, which answers "Invalid chainId"
 * (HTTP 400): the block tracker never starts and nothing can be sent. mm reads
 * the wallet's customEvmChains first and uses an entry's rpcTarget when it has
 * one, so one entry fixes it -- the same entry a user could add by hand. It is
 * added only if missing, only before a real submission on testnet, and the
 * person is told. Returns true when it changed something.
 */
export const MONAD_TESTNET_RPC = {
  key: 'monad-testnet',
  chainId: REGISTRY_CHAIN_ID,
  caip2: `eip155:${REGISTRY_CHAIN_ID}`,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  blockExplorer: 'https://testnet.monadexplorer.com',
  rpcTarget: 'https://testnet-rpc.monad.xyz',
};

interface StateManager {
  read(): { customEvmChains?: { chainId: number; rpcTarget?: string }[] };
  updateWith(fn: (s: { customEvmChains?: unknown[] }) => Record<string, unknown>): unknown;
}

export function ensureMonadTestnetRpc(state: StateManager): boolean {
  const has = (state.read().customEvmChains ?? []).some((c) => c.chainId === REGISTRY_CHAIN_ID && c.rpcTarget);
  if (has) return false;
  state.updateWith((s) => ({
    customEvmChains: [
      ...((s.customEvmChains ?? []) as { chainId: number }[]).filter((c) => c.chainId !== REGISTRY_CHAIN_ID),
      MONAD_TESTNET_RPC,
    ],
  }));
  return true;
}

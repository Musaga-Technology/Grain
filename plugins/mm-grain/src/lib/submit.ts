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

export async function executorRequest(chainId: number, tx: { to: `0x${string}`; value: `0x${string}`; data: `0x${string}` }) {
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

  return { kind: 'transaction', chainId, transaction };
}

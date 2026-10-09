/**
 * The request mm's wallet executor expects, built exactly as mm's own
 * `wallet send-transaction` builds it: quantities as bigint, `data` left out
 * when there is none. Passing `value` as a hex string -- the JSON-RPC habit --
 * gets the request rejected by MetaMask's wallet service.
 */
export function executorRequest(chainId: number, tx: { to: `0x${string}`; value: `0x${string}`; data: `0x${string}` }) {
  return {
    kind: 'transaction',
    chainId,
    transaction: {
      to: tx.to,
      value: BigInt(tx.value),
      ...(tx.data && tx.data !== '0x' ? { data: tx.data } : {}),
    },
  };
}

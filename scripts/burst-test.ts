/**
 * Parallel-execution burst test: many creators registering at the same moment.
 *
 * Runs against THROWAWAY deployments (script/DeployBurst.s.sol), never the live
 * registry. N fresh accounts each register once, all sent at the same instant
 * as pre-signed transactions, the way N real creators pressing "Register"
 * together would hit the chain.
 *
 *   v1  GrainRegistry: ids from one shared counter. Every creator reads the
 *       counter, embeds that id in the watermark, and sends. Expect one
 *       success per round and the rest refused (UnexpectedRecordId); the
 *       refused retry once to show the pattern repeats.
 *   v2  GrainRegistryV2: each creator reserves an id range first, then
 *       registers from it. Expect every registration to land.
 *
 * Leftover funds are swept back to the deployer. Results go to
 * docs/evidence/burst-<date>.json and are written up in docs/PARALLEL.md.
 *
 *   node --experimental-strip-types scripts/burst-test.ts <v1> <v2> [n]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import {
  createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi, parseEther, formatEther,
  type Hex, type PublicClient,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';

const [V1, V2, nArg] = process.argv.slice(2) as [Hex, Hex, string?];
const N = Number(nArg ?? 20);
const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const RPC = env.RPC_TESTNET_ENDPOINT;
const chain = { id: 10143, name: 'Monad Testnet', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;
const transport = http(RPC);
const pub = createPublicClient({ chain, transport, pollingInterval: 200 }) as PublicClient;
const deployer = privateKeyToAccount(`0x${env.PRIVATE_KEY.replace(/^0x/, '')}` as Hex);

const v1Abi = parseAbi([
  'function register(uint64 expectedRecordId, uint64 fingerprint, bytes manifest) returns (uint64)',
  'function nextRecordId() view returns (uint64)',
]);
const v2Abi = parseAbi([
  'function reserve(uint32 count) returns (uint64)',
  'function register(uint64 recordId, uint64 fingerprint, bytes manifest) returns (uint64)',
  'function rangeOf(address) view returns (uint64 next, uint64 end)',
]);

const REGISTER_GAS = 750_000n; // into a fresh index, Monad measures ~580k (cold storage costs more than on Ethereum); Monad charges the whole limit
const RESERVE_GAS = 100_000n;
const randomFingerprint = () => BigInt.asUintN(64, BigInt(`0x${[...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('')}`));
const manifest = `0x${'ab'.repeat(32)}` as Hex;

async function fees() {
  const [block, tip] = await Promise.all([pub.getBlock(), pub.estimateMaxPriorityFeePerGas()]);
  return { maxPriorityFeePerGas: tip, maxFeePerGas: ((block.baseFeePerGas ?? 0n) * 5n) / 4n + tip };
}

/** Sign every tx first, then send all at once: the burst. */
async function burst(label: string, txs: { account: PrivateKeyAccount; to: Hex; data: Hex; gas: bigint }[]) {
  const f = await fees();
  const signed = await Promise.all(txs.map(async (t) => {
    const nonce = await pub.getTransactionCount({ address: t.account.address, blockTag: 'pending' });
    return t.account.signTransaction({ chainId: chain.id, type: 'eip1559', to: t.to, data: t.data, gas: t.gas, nonce, ...f });
  }));
  const start = performance.now();
  const hashes = await Promise.all(signed.map((raw) => pub.sendRawTransaction({ serializedTransaction: raw }).catch((e) => e as Error)));
  const receipts = await Promise.all(hashes.map((h) => (h instanceof Error ? null : pub.waitForTransactionReceipt({ hash: h, timeout: 60_000 }).catch(() => null))));
  const elapsed = (performance.now() - start) / 1000;
  const ok = receipts.filter((r) => r?.status === 'success');
  const sendErrors = hashes.filter((h) => h instanceof Error).map((e) => (e as Error).message.split('\n').find((l) => /Details|reason|error/i.test(l)) ?? (e as Error).message.split('\n')[0]);
  const noReceipt = hashes.filter((h, i) => !(h instanceof Error) && !receipts[i]).length;
  if (sendErrors.length || noReceipt) console.log(`  ${label}: ${sendErrors.length} send errors, ${noReceipt} sent but no receipt in 60s`, [...new Set(sendErrors)].slice(0, 3));
  const blocks = [...new Set(receipts.filter(Boolean).map((r) => Number(r!.blockNumber)))].sort((a, b) => a - b);
  const result = {
    label, sent: txs.length, succeeded: ok.length,
    reverted: receipts.filter((r) => r && r.status !== 'success').length,
    notIncluded: txs.length - receipts.filter(Boolean).length,
    sendErrors: [...new Set(sendErrors)],
    blocks: blocks.length, firstBlock: blocks[0], lastBlock: blocks.at(-1), seconds: Number(elapsed.toFixed(2)),
    perBlock: blocks.map((b) => ({ block: b, landed: receipts.filter((r) => r && Number(r.blockNumber) === b && r.status === 'success').length, reverted: receipts.filter((r) => r && Number(r.blockNumber) === b && r.status !== 'success').length })),
  };
  console.log(`${label}: ${result.succeeded}/${result.sent} landed, ${result.reverted} reverted, ${result.notIncluded} not included, across ${result.blocks} block(s), ${result.seconds}s`);
  return { result, success: receipts.map((r) => r?.status === 'success') };
}

// 1. Fund N fresh accounts.
// Monad's Reserve Balance rule (docs.monad.xyz/developer-essentials/reserve-balance):
// a value transfer may not take the sender below its 10 MON reserve unless it
// is an "emptying" transaction -- the sender's only transaction in the last
// k = 3 blocks. Back-to-back funding transfers from one account therefore
// revert once its balance nears 10 MON. So fund one account at a time, at
// least 3 blocks apart, and confirm each landed.
const accounts = Array.from({ length: N }, () => privateKeyToAccount(generatePrivateKey()));
const fund = createWalletClient({ account: deployer, chain, transport });
const FUNDING = parseEther('0.3');
console.log(`funding ${N} accounts, one per 3-block window...`);
for (const a of accounts) {
  for (let attempt = 1; ; attempt++) {
    const hash = await fund.sendTransaction({ to: a.address, value: FUNDING });
    const r = await pub.waitForTransactionReceipt({ hash });
    const startBlock = r.blockNumber;
    while ((await pub.getBlockNumber()) < startBlock + 4n) await new Promise((res) => setTimeout(res, 150));
    if (r.status === 'success' && (await pub.getBalance({ address: a.address })) >= FUNDING) break;
    if (attempt >= 3) throw new Error(`could not fund ${a.address}`);
  }
}
console.log('all funded');

const out: Record<string, unknown> = { date: new Date().toISOString(), n: N, v1: V1, v2: V2 };

// 2. v1: everyone reads the shared counter, embeds that id, and sends.
let id = await pub.readContract({ address: V1, abi: v1Abi, functionName: 'nextRecordId' });
const r1 = await burst('v1 round 1', accounts.map((account) => ({
  account, to: V1, gas: REGISTER_GAS,
  data: encodeFunctionData({ abi: v1Abi, functionName: 'register', args: [id, randomFingerprint(), manifest] }),
})));
out.v1Round1 = r1.result;
const refused = accounts.filter((_, i) => !r1.success[i]);
await new Promise((r) => setTimeout(r, 2000));
id = await pub.readContract({ address: V1, abi: v1Abi, functionName: 'nextRecordId' });
const r2 = await burst('v1 round 2 (the refused retry)', refused.map((account) => ({
  account, to: V1, gas: REGISTER_GAS,
  data: encodeFunctionData({ abi: v1Abi, functionName: 'register', args: [id, randomFingerprint(), manifest] }),
})));
out.v1Round2 = r2.result;

// 3. v2: reserve a range each, then everyone registers from their own range.
const res = await burst('v2 reserve', accounts.map((account) => ({
  account, to: V2, gas: RESERVE_GAS, data: encodeFunctionData({ abi: v2Abi, functionName: 'reserve', args: [5] }),
})));
out.v2Reserve = res.result;
await new Promise((r) => setTimeout(r, 2000));
const firsts = await Promise.all(accounts.map((a) => pub.readContract({ address: V2, abi: v2Abi, functionName: 'rangeOf', args: [a.address] })));
const r3 = await burst('v2 register', accounts.map((account, i) => ({
  account, to: V2, gas: REGISTER_GAS,
  data: encodeFunctionData({ abi: v2Abi, functionName: 'register', args: [firsts[i][0], randomFingerprint(), manifest] }),
})));
out.v2Register = r3.result;

// 4. Sweep leftovers back to the deployer.
await new Promise((r) => setTimeout(r, 2000));
const f = await fees();
let swept = 0n;
await Promise.all(accounts.map(async (a) => {
  const bal = await pub.getBalance({ address: a.address });
  const cost = 21_000n * f.maxFeePerGas;
  if (bal <= cost) return;
  const w = createWalletClient({ account: a, chain, transport });
  await w.sendTransaction({ to: deployer.address, value: bal - cost, gas: 21_000n, ...f }).then(() => { swept += bal - cost; }).catch(() => {});
}));
console.log(`swept ${formatEther(swept)} MON back to the deployer`);

mkdirSync('docs/evidence', { recursive: true });
const file = `docs/evidence/burst-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${file}`);

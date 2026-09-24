/**
 * Seed the registry with fingerprints from a real image corpus.
 *
 * RESUMABLE BY DESIGN. Testnet MON arrives by faucet in small amounts, so the
 * corpus grows over days rather than landing in one run. State lives in
 * .corpus-seeded.json; re-running tops up from wherever it stopped, and the
 * number quoted in the demo is whatever the registry actually holds on the day.
 *
 * Only fingerprints go on chain. The images are never uploaded or
 * redistributed, which is what makes the corpus licensing question easy.
 *
 * Run: node --experimental-strip-types scripts/seed.ts [limit]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createWalletClient, createPublicClient, http, parseAbi, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { decodeImage, fingerprint, buildManifest, signManifest, encodeSignedManifest, toBands }
  from '../packages/grain-core/src/index.ts';

const ROOT = join(import.meta.dirname, '..');
const CORPUS = join(ROOT, '.corpus');
const STATE = join(ROOT, '.corpus-seeded.json');
const DEPLOY = JSON.parse(readFileSync(join(ROOT, 'deployments', 'monad-testnet.json'), 'utf8'));
const limit = Number(process.argv[2] ?? Infinity);

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const account = privateKeyToAccount(`0x${env.PRIVATE_KEY.replace(/^0x/, '')}` as Hex);
const chain = { id: 10143, name: 'Monad Testnet', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
                rpcUrls: { default: { http: [env.RPC_TESTNET_ENDPOINT] } } } as const;
const transport = http(env.RPC_TESTNET_ENDPOINT);
const pub = createPublicClient({ chain, transport });
const wallet = createWalletClient({ account, chain, transport });

const REGISTRY = DEPLOY.contracts.GrainRegistry as Hex;
const INDEX = DEPLOY.contracts.FingerprintIndex as Hex;
const abi = parseAbi([
  'function register(uint64 expectedRecordId, uint64 fingerprint, bytes manifest) returns (uint64)',
  'function nextRecordId() view returns (uint64)',
]);
const indexAbi = parseAbi(['function bandSize(uint8 band, uint8 value) view returns (uint256)']);

type State = Record<string, number>;
const state: State = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};

const files = readdirSync(CORPUS).filter((f) => /\.(jpg|jpeg|png)$/i.test(f)).sort();
const pending = files.filter((f) => state[f] === undefined).slice(0, limit);

console.log(`corpus ${files.length} | already seeded ${Object.keys(state).length} | this run ${pending.length}`);
if (pending.length === 0) { console.log('nothing to do'); process.exit(0); }

const gasPrice = await pub.getGasPrice();
const balance = await pub.getBalance({ address: account.address });
const PER_REGISTRATION = 95_000n; // measured warm cost, docs/GAS.md
const affordable = Number(balance / (gasPrice * PER_REGISTRATION));
console.log(`balance ${(Number(balance) / 1e18).toFixed(3)} MON at ${Number(gasPrice) / 1e9} gwei`);
console.log(`budget covers roughly ${affordable.toLocaleString()} registrations`);

if (affordable < pending.length) {
  console.log(`\nSTOPPING at ${affordable} of ${pending.length}: not enough balance for the rest.`);
  console.log('Top up and re-run -- this script resumes from where it left off.');
  pending.length = Math.max(0, affordable - 1);
}

let seeded = 0, failed = 0;
for (const file of pending) {
  try {
    const img = decodeImage(readFileSync(join(CORPUS, file)), { maxMemoryMB: 256 });
    const fp = fingerprint(img);

    // nextRecordId is read fresh each time: register() reverts if the id moved,
    // which is the same guard real registrations rely on.
    const expected = await pub.readContract({ address: REGISTRY, abi, functionName: 'nextRecordId' });

    const manifest = await signManifest(
      buildManifest({
        recordId: expected, creator: account.address, fingerprint: fp,
        watermarked: false, // seed records are hashed, never watermarked
        generator: 'Grain seed corpus (Lorem Picsum / Unsplash)',
        title: `Seed corpus image ${file.replace(/\.\w+$/, '')}`,
      }),
      `0x${env.PRIVATE_KEY.replace(/^0x/, '')}` as Hex,
    );

    const hash = await wallet.writeContract({
      address: REGISTRY, abi, functionName: 'register',
      args: [expected, fp, `0x${Buffer.from(encodeSignedManifest(manifest)).toString('hex')}` as Hex],
    });
    await pub.waitForTransactionReceipt({ hash });

    state[file] = Number(expected);
    seeded++;
    if (seeded % 10 === 0 || seeded === pending.length) {
      writeFileSync(STATE, JSON.stringify(state, null, 2));
      process.stdout.write(`\r  seeded ${seeded}/${pending.length}`);
    }
  } catch (e) {
    failed++;
    console.warn(`\n  FAILED ${file}: ${(e as Error).message.split('\n')[0].slice(0, 120)}`);
    if (failed > 5) { console.error('too many failures, stopping'); break; }
  }
}
writeFileSync(STATE, JSON.stringify(state, null, 2));

const total = await pub.readContract({ address: REGISTRY, abi, functionName: 'nextRecordId' });
console.log(`\n\nseeded ${seeded} this run, ${failed} failed. registry now holds ${Number(total) - 1} records.`);

// Bucket distribution is what SPEC 6.3 asks to be measured rather than reasoned
// about: the mean is uninteresting, the tail is what costs gas to read.
const seededFps = Object.keys(state).map((f) => fingerprint(decodeImage(readFileSync(join(CORPUS, f)))));
const counts: number[] = [];
for (let band = 0; band < 8; band++) {
  const local = new Map<number, number>();
  for (const fp of seededFps) local.set(toBands(fp)[band], (local.get(toBands(fp)[band]) ?? 0) + 1);
  counts.push(...local.values());
}
counts.sort((a, b) => a - b);
if (counts.length) {
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  console.log(`bucket occupancy: mean ${mean.toFixed(1)}, median ${counts[Math.floor(counts.length / 2)]}, max ${counts[counts.length - 1]} (${counts.length} non-empty of 2048)`);
}

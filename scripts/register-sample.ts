/**
 * Registers the licensable sample: the meadow artwork, as @grain-studio, with
 * a licence price, so `mm grain license` and the "A reposted copy" sample have
 * a real record to work against.
 *
 * It follows the register page step for step -- watermark with the next record
 * id, fingerprint the *marked* image, sign the manifest, register -- so the
 * record is indistinguishable from one made in the browser. The creator key is
 * generated once and kept in .env as SAMPLES_PRIVATE_KEY (gitignored).
 *
 *   npx esbuild scripts/register-sample.ts --bundle --platform=node --format=esm \
 *     --alias:onnxruntime-web/wasm=onnxruntime-web --external:onnxruntime-web \
 *     --outfile=.tools/register-sample.mjs && node .tools/register-sample.mjs
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPublicClient, createWalletClient, formatEther, http, parseAbi, parseEther, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  buildManifest, decodeImage, encodePNG, encodeSignedManifest, fingerprint, signManifest,
} from '../packages/grain-core/src/index.ts';
import { encodeWatermark, useModelBytes } from '../apps/web/app/lib/trustmark/index.ts';

const ROOT = process.cwd();
const HANDLE = 'grain-studio';
const PRICE = parseEther('0.01');
const SOURCE = join(ROOT, '.corpus', 'samples', 'meadow.png');
const OUT = join(ROOT, '.corpus', 'samples', 'meadow-grain.png');

const envFile = join(ROOT, '.env');
const env = Object.fromEntries(readFileSync(envFile, 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
if (!env.SAMPLES_PRIVATE_KEY) {
  env.SAMPLES_PRIVATE_KEY = generatePrivateKey();
  appendFileSync(envFile, `\n# Creator key for the @${HANDLE} sample (scripts/register-sample.ts)\nSAMPLES_PRIVATE_KEY=${env.SAMPLES_PRIVATE_KEY}\n`);
}
const key = env.SAMPLES_PRIVATE_KEY as Hex;
const creator = privateKeyToAccount(key);
const faucet = privateKeyToAccount(`0x${env.FAUCET_PRIVATE_KEY.replace(/^0x/, '')}` as Hex);

const D = JSON.parse(readFileSync(join(ROOT, 'deployments', 'monad-testnet.json'), 'utf8'));
const chain = { id: 10143, name: 'Monad Testnet', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [env.RPC_TESTNET_ENDPOINT] } } } as const;
const transport = http(env.RPC_TESTNET_ENDPOINT);
const pub = createPublicClient({ chain, transport });
const as = (account: typeof creator) => createWalletClient({ account, chain, transport });

const registryAbi = parseAbi([
  'function register(uint64 expectedRecordId, uint64 fingerprint, bytes manifest) returns (uint64)',
  'function nextRecordId() view returns (uint64)',
]);
const creatorAbi = parseAbi(['function setProfile(string handle, string profileURI, uint256 licensePriceWei)']);

console.log(`creator ${creator.address}`);
const balance = await pub.getBalance({ address: creator.address });
if (balance < parseEther('0.05')) {
  const hash = await as(faucet).sendTransaction({ to: creator.address, value: parseEther('0.1') });
  await pub.waitForTransactionReceipt({ hash });
  console.log('funded 0.1 MON from the faucet wallet');
}

const M = join(ROOT, 'apps', 'web', 'public', 'models');
useModelBytes({
  encoder: readFileSync(join(M, 'encoder_Q.onnx')),
  resizer: readFileSync(join(M, 'resizer.onnx')),
});

const recordId = await pub.readContract({ address: D.contracts.GrainRegistry, abi: registryAbi, functionName: 'nextRecordId' });
const marked = await encodeWatermark(decodeImage(new Uint8Array(readFileSync(SOURCE))), recordId);
writeFileSync(OUT, encodePNG(marked));
const fp = fingerprint(marked);

const manifest = await signManifest(buildManifest({
  recordId, creator: creator.address, fingerprint: fp, watermarked: true,
  generator: 'Grain sample art (scripts/make-sample-art.ts)',
  title: 'Meadow',
}), key);

let hash = await as(creator).writeContract({
  address: D.contracts.GrainRegistry, abi: registryAbi, functionName: 'register',
  args: [recordId, fp, `0x${Buffer.from(encodeSignedManifest(manifest)).toString('hex')}` as Hex],
});
await pub.waitForTransactionReceipt({ hash });
console.log(`registered record ${recordId}  tx ${hash}`);

hash = await as(creator).writeContract({
  address: D.contracts.CreatorRegistry, abi: creatorAbi, functionName: 'setProfile', args: [HANDLE, '', PRICE],
});
await pub.waitForTransactionReceipt({ hash });
console.log(`@${HANDLE}, licence price ${formatEther(PRICE)} MON  tx ${hash}`);
console.log(`marked image: ${OUT}`);

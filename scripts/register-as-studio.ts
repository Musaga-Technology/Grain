/**
 * Registers an image as @grain-studio, the demo's established creator, with
 * how it was made declared truthfully (C2PA digitalSourceType).
 *
 * Same steps as the register page: watermark with the next record id,
 * fingerprint the marked image, sign the manifest, register. Uses the
 * SAMPLES_PRIVATE_KEY that scripts/register-sample.ts created; leaves the
 * creator's profile and licence price as they are.
 *
 *   npx esbuild scripts/register-as-studio.ts --bundle --platform=node --format=esm \
 *     --alias:onnxruntime-web/wasm=onnxruntime-web --external:onnxruntime-web \
 *     --outfile=.tools/register-as-studio.mjs
 *   node .tools/register-as-studio.mjs <in.png> <out.png> "<title>" [--ai "<tool>"]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPublicClient, createWalletClient, http, parseAbi, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  buildManifest, decodeImage, DIGITAL_SOURCE, encodePNG, encodeSignedManifest, fingerprint, signManifest,
} from '../packages/grain-core/src/index.ts';
import { encodeWatermark, useModelBytes } from '../apps/web/app/lib/trustmark/index.ts';

const [SOURCE, OUT, TITLE, flag, tool] = process.argv.slice(2);
if (!SOURCE || !OUT || !TITLE) throw new Error('usage: <in.png> <out.png> "<title>" [--ai "<tool>"]');
const ai = flag === '--ai';

const ROOT = process.cwd();
const env = Object.fromEntries(readFileSync(join(ROOT, '.env'), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const key = env.SAMPLES_PRIVATE_KEY as Hex;
const creator = privateKeyToAccount(key);

const D = JSON.parse(readFileSync(join(ROOT, 'deployments', 'monad-testnet.json'), 'utf8'));
const chain = { id: 10143, name: 'Monad Testnet', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [env.RPC_TESTNET_ENDPOINT] } } } as const;
const transport = http(env.RPC_TESTNET_ENDPOINT);
const pub = createPublicClient({ chain, transport });
const wallet = createWalletClient({ account: creator, chain, transport });
const registryAbi = parseAbi([
  'function register(uint64 expectedRecordId, uint64 fingerprint, bytes manifest) returns (uint64)',
  'function nextRecordId() view returns (uint64)',
]);

const M = join(ROOT, 'apps', 'web', 'public', 'models');
useModelBytes({ encoder: readFileSync(join(M, 'encoder_Q.onnx')), resizer: readFileSync(join(M, 'resizer.onnx')) });

const recordId = await pub.readContract({ address: D.contracts.GrainRegistry, abi: registryAbi, functionName: 'nextRecordId' });
const marked = await encodeWatermark(decodeImage(new Uint8Array(readFileSync(SOURCE))), recordId);
writeFileSync(OUT, encodePNG(marked));
const fp = fingerprint(marked);

const manifest = await signManifest(buildManifest({
  recordId, creator: creator.address, fingerprint: fp, watermarked: true, title: TITLE,
  generator: 'Grain (scripts/register-as-studio.ts)',
  created: ai
    ? { digitalSourceType: DIGITAL_SOURCE.aiGenerated, ...(tool ? { softwareAgent: tool } : {}) }
    : { digitalSourceType: DIGITAL_SOURCE.digitalCapture },
}), key);

const hash = await wallet.writeContract({
  address: D.contracts.GrainRegistry, abi: registryAbi, functionName: 'register',
  args: [recordId, fp, `0x${Buffer.from(encodeSignedManifest(manifest)).toString('hex')}` as Hex],
});
const receipt = await pub.waitForTransactionReceipt({ hash });
console.log(`${receipt.status}: record ${recordId} as ${creator.address}  tx ${hash}`);
console.log(`marked image: ${OUT}`);

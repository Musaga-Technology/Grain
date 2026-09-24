import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createPublicClient, http, parseAbi } from 'viem';
import deployments from '../../../../../deployments/monad-testnet.json';

const run = promisify(execFile);

/**
 * Reserve a recordId and embed the watermark.
 *
 * THIS CANNOT HAPPEN IN THE BROWSER. SPEC §8.4 step 5 says the watermark is
 * embedded client-side, but TrustMark's official JavaScript build is
 * decode-only; encoding needs the Rust crate. So the image is sent here, marked,
 * and sent back, and the browser does everything after that.
 *
 * The recordId has to be decided BEFORE marking, because the watermark carries
 * it. The registry's register() takes that id as `expectedRecordId` and reverts
 * if another registration landed first, rather than silently binding this
 * watermark to someone else's record.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_BYTES = 25 * 1024 * 1024;
const TM = process.env.TRUSTMARK_BIN ?? '.tools/trustmark';
const MODELS = process.env.TRUSTMARK_MODELS ?? '.tools/models';

const registryAbi = parseAbi(['function nextRecordId() view returns (uint64)']);

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get('image');
  if (!(file instanceof File)) {
    return Response.json({ error: 'expected an image' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: 'That image is too large. Try one under 25MB.' }, { status: 413 });
  }

  const client = createPublicClient({ transport: http(process.env.RPC_TESTNET_ENDPOINT) });
  const recordId = await client.readContract({
    address: deployments.contracts.GrainRegistry as `0x${string}`,
    abi: registryAbi,
    functionName: 'nextRecordId',
  });

  const dir = await mkdtemp(join(tmpdir(), 'grain-mark-'));
  try {
    const input = join(dir, 'in.png');
    const output = join(dir, 'out.png');
    await writeFile(input, new Uint8Array(await file.arrayBuffer()));

    // BCH_SUPER carries 40 data bits, which is the CLI default and ours.
    const payload = recordId.toString(2).padStart(40, '0');
    await run(TM, ['-m', MODELS, 'encode', '-i', input, '-o', output, '-w', payload],
      { timeout: 60_000 });

    const marked = await readFile(output);
    return new Response(new Uint8Array(marked), {
      headers: {
        'content-type': 'image/png',
        'x-grain-record-id': recordId.toString(),
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    console.error('watermark embed failed', e);
    return Response.json({ error: "Grain couldn't prepare that image. Try again." }, { status: 500 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

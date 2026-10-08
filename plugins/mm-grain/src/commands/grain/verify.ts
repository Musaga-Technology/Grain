import {
  type CommandIO, InputFieldType, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags,
} from '@metamask/agent-wallet/plugin';
import { verifyImage } from '../../lib/grain.ts';
import { loadImage } from '../../lib/image.ts';
import { decodeWatermark, loadDecoder } from '../../lib/watermark.ts';
import { toResult, type VerifyResult } from '../../lib/format.ts';

const inputs = {
  image: {
    type: InputFieldType.Text, flag: 'image', index: 0, required: true, prompt: true,
    message: 'Image to check: a local PNG/JPEG path or an http(s) URL',
  },
  fast: {
    type: InputFieldType.Boolean, flag: 'fast', required: false, prompt: false,
    message: 'Skip the watermark check and match by fingerprint only (no model download, but cannot detect forged watermarks)',
  },
} satisfies InputSchema;

export default class GrainVerify extends PluginCommand<VerifyResult> {
  static override description =
    'Find out who made an image, from the image itself: even after screenshots, crops and re-encoding. Detects forged credentials.';

  static override examples = [
    '<%= config.bin %> grain verify ./photo.jpg',
    '<%= config.bin %> grain verify https://grain-on-monad.vercel.app/samples/forged.jpg --json',
    '<%= config.bin %> grain verify ./photo.jpg --fast',
  ];

  // Reading the public registry needs no account and no wallet.
  static override requiresAuth = false;
  static override requiresInit = false;
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = 'grain:verify';

  async execute(io: CommandIO): Promise<VerifyResult> {
    const { image, fast } = await io.resolveInputs(inputs);
    const bytes = await loadImage(String(image));
    if (!fast) {
      await loadDecoder((file, mb) => io.progress(`Downloading the TrustMark ${file} model (${mb.toFixed(0)} MB, first run only)`));
    }
    io.progress('Checking the watermark and the fingerprint');
    const result = toResult(await verifyImage(bytes, fast ? null : decodeWatermark));
    io.progress();
    return result;
  }

  override successHint(r: VerifyResult): string {
    const lines = [r.summary];
    if (r.record) lines.push(`Record: ${r.record.url}`);
    if (r.onChainDistance !== null) lines.push(`Checked on chain: FingerprintIndex.verify() says ${r.onChainDistance} bits apart.`);
    return lines.join('\n');
  }
}

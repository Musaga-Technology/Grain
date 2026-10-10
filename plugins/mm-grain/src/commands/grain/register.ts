import { writeFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import {
  type CommandIO, InputFieldType, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags,
} from '@metamask/agent-wallet/plugin';
import { encodeFunctionData, toHex } from 'viem';
import {
  buildManifest, controlsAgent, decodeImage, DIGITAL_SOURCE, encodePNG, encodeSignedManifest, ERC8004_IDENTITY_TESTNET,
  fingerprint, manifestHash, verifyManifest,
} from '../../../../../packages/grain-core/src/index.ts';
import { agentIdentity, GRAIN_REGISTRY, grainRegistryAbi, nextRecordId, registryClient, selectedAddress, SITE } from '../../lib/grain.ts';
import { loadImage } from '../../lib/image.ts';
import { encodeWatermark, loadEncoder } from '../../lib/watermark.ts';
import { ensureMonadTestnetRpc, executorRequest } from '../../lib/submit.ts';

/**
 * Register an image this agent generated.
 *
 * The same steps as the website: embed an invisible watermark carrying the
 * next record id, fingerprint the marked image, sign the manifest, register.
 * The manifest declares the image AI-generated and, with --agent-id, names the
 * agent's ERC-8004 identity -- refused unless this wallet controls that agent,
 * so an agent can't credit its work to someone else's identity. Two MetaMask
 * approvals: signing the manifest, then the transaction.
 */

const inputs = {
  image: { type: InputFieldType.Text, flag: 'image', index: 0, required: true, prompt: true, message: 'The image to register: a PNG/JPEG path or http(s) URL' },
  agentId: { type: InputFieldType.Text, flag: 'agent-id', required: false, prompt: false, message: "This agent's ERC-8004 id (from mm grain agent)" },
  title: { type: InputFieldType.Text, flag: 'title', required: false, prompt: false, message: 'A title for the image' },
  out: { type: InputFieldType.Text, flag: 'out', required: false, prompt: false, message: 'Where to save the watermarked copy (default: <name>-grain.png)' },
} satisfies InputSchema;

type RegisterResult = { recordId: string; agentId: string | null; file: string; hash?: string; status?: string; failureReason?: string; url: string };

export default class GrainRegister extends PluginCommand<RegisterResult> {
  static override description = "Register an image this agent generated, watermarked and credited to its ERC-8004 identity.";
  static override examples = ['<%= config.bin %> grain register ./generated.png --agent-id 2095 --title "Aurora"'];
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = 'grain:register';

  async execute(io: CommandIO): Promise<RegisterResult> {
    const { image, agentId, title, out } = await io.resolveInputs(inputs);
    const address = selectedAddress(this.ctx.walletStateManager.read() as never);
    if (!address) throw new Error("Couldn't find this wallet's address. Run `mm wallet address` to check the wallet is set up.");

    let agentName: string | undefined;
    const id = agentId ? String(agentId).trim() : '';
    if (id) {
      if (!/^\d+$/.test(id)) throw new Error('--agent-id is a number, e.g. 2095.');
      const agent = await agentIdentity(ERC8004_IDENTITY_TESTNET, BigInt(id));
      if (!agent) throw new Error(`There is no ERC-8004 agent #${id} on Monad testnet.`);
      if (!controlsAgent(agent, address)) throw new Error(`This wallet (${address}) doesn't control ERC-8004 agent #${id}; its owner is ${agent.owner}.`);
      agentName = agent.name;
    }

    const source = String(image);
    const original = decodeImage(await loadImage(source));
    await loadEncoder((file, mb) => io.progress(`Downloading the TrustMark ${file} model${mb ? ` (${mb.toFixed(0)} MB)` : ''}, first run only`));
    if (ensureMonadTestnetRpc(this.ctx.walletStateManager as never)) {
      io.progress("Pointed MetaMask at Monad testnet's own RPC (its default proxy rejects chain 10143)");
    }
    const executor = await this.ctx.walletExecutor(io, 'grain:register');
    const who = agentName ?? (id ? `agent #${id}` : 'this agent');

    // The next id from the shared counter; if another registration takes it
    // first, re-mark with the new id and try again (see docs/PARALLEL.md).
    for (let attempt = 1; ; attempt++) {
      const recordId = await nextRecordId();
      io.progress('Adding the invisible mark');
      const marked = await encodeWatermark(original, recordId);
      const fp = fingerprint(marked);
      const manifest = buildManifest({
        recordId, creator: address, fingerprint: fp, watermarked: true,
        title: title ? String(title).slice(0, 200) : undefined,
        generator: 'mm-plugin-grain',
        created: { digitalSourceType: DIGITAL_SOURCE.aiGenerated, ...(agentName ? { softwareAgent: agentName } : {}) },
        ...(id ? { agent: { registry: `eip155:10143:${ERC8004_IDENTITY_TESTNET}`, agentId: id } } : {}),
      });
      io.progress();

      // MetaMask's wallet signs text, so the agent signs the manifest hash as
      // 0x-hex text; Grain accepts that form (see grain-core verifyManifest).
      const signed = (await executor(
        { kind: 'message', chainId: 10143, message: manifestHash(manifest) } as never, { signal: io.signal } as never,
      )) as { signature?: `0x${string}`; failureDescription?: string };
      if (!signed.signature) throw new Error(`The manifest was not signed${signed.failureDescription ? `: ${signed.failureDescription}` : '.'}`);
      const full = { ...manifest, signature: signed.signature };
      if (!(await verifyManifest(full))) throw new Error('The wallet returned a signature that does not match the manifest.');

      const result = (await executor(
        (await executorRequest(10143, {
          to: GRAIN_REGISTRY,
          value: '0x0',
          data: encodeFunctionData({ abi: grainRegistryAbi, functionName: 'register', args: [recordId, fp, toHex(encodeSignedManifest(full))] }),
        }, { action: 'custom', summary: `Register ${title ? `"${title}"` : 'an image'} on Grain as AI-generated by ${who}` }, address)) as never,
        { signal: io.signal } as never,
      )) as { status?: string; hash?: `0x${string}`; failureDescription?: string };

      let ok = Boolean(result.hash);
      if (result.hash) ok = (await registryClient().waitForTransactionReceipt({ hash: result.hash })).status === 'success';
      if (!ok && attempt < 3 && (await nextRecordId()) > recordId) continue;

      const file = out ? String(out) : `${basename(source.split('?')[0], extname(source.split('?')[0])) || 'image'}-grain.png`;
      if (ok) await writeFile(file, encodePNG(marked));
      return {
        recordId: recordId.toString(), agentId: id || null, file, hash: result.hash, status: result.status,
        failureReason: ok ? undefined : (result.failureDescription ?? 'the registration did not go through'), url: `${SITE}/r/${recordId}`,
      };
    }
  }

  override successHint(r: RegisterResult): string {
    if (r.failureReason) return `Not registered: ${r.failureReason}`;
    return `Registered record ${r.recordId}${r.agentId ? `, credited to ERC-8004 agent #${r.agentId}` : ''}.\nWatermarked copy: ${r.file} (publish this one, not the original)\n${r.url}${r.hash ? `\nTransaction: https://testnet.monadscan.com/tx/${r.hash}` : ''}`;
  }
}

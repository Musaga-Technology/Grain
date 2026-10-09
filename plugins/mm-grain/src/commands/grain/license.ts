import {
  type CommandIO, InputFieldType, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags,
} from '@metamask/agent-wallet/plugin';
import { planLicence, type LicencePlan } from '../../lib/payment.ts';
import { who } from '../../lib/format.ts';
import { executorRequest } from '../../lib/submit.ts';

/**
 * License an image through Grain's LicenseRegistry on Monad testnet.
 *
 * Unlike `pay`, the price is the creator's, not the agent's: they set it when
 * they registered. The contract forwards it in full to them -- there is no
 * protocol fee -- and records the licence on chain, where anyone (and Grain's
 * Envio indexer) can see the agent paid.
 */

const inputs = {
  target: {
    type: InputFieldType.Text, flag: 'target', index: 0, required: true, prompt: true,
    message: 'The image (path or URL) to license, or a Grain record number',
  },
  maxPrice: {
    type: InputFieldType.Text, flag: 'max-price', required: false, prompt: false,
    message: 'Refuse if the creator asks more than this, in MON. Recommended for unattended agents',
  },
  dryRun: {
    type: InputFieldType.Boolean, flag: 'dry-run', required: false, prompt: false,
    message: 'Show the price and the transaction without sending it',
  },
} satisfies InputSchema;

type LicenceResult = LicencePlan & { sent: boolean; status?: string; hash?: string; failureReason?: string };

export default class GrainLicense extends PluginCommand<LicenceResult> {
  static override description =
    "License an image at its creator's price, paid to them through Grain's LicenseRegistry and recorded on chain.";

  static override examples = [
    '<%= config.bin %> grain license https://grain-on-monad.vercel.app/samples/reposted.jpg --max-price 0.05',
    '<%= config.bin %> grain license 511 --dry-run --json',
  ];

  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = 'grain:license';

  async execute(io: CommandIO): Promise<LicenceResult> {
    const { target, maxPrice, dryRun } = await io.resolveInputs(inputs);
    const plan = await planLicence(String(target), maxPrice ? String(maxPrice) : undefined, (l) => io.progress(l));
    if (dryRun) return { ...plan, sent: false };

    const executor = await this.ctx.walletExecutor(io, 'grain:license');
    const result = (await executor(
      (await executorRequest(plan.chainId, plan.transaction)) as never,
      { signal: io.signal } as never,
    )) as { status?: string; hash?: string; failureDescription?: string };
    return { ...plan, sent: true, status: result.status, hash: result.hash, failureReason: result.failureDescription };
  }

  override successHint(r: LicenceResult): string {
    const to = who({ creatorHandle: r.creatorHandle ?? undefined, creator: r.creator });
    if (!r.sent) return `Licensing record ${r.recordId} costs ${r.price} MON, paid in full to ${to}. Nothing was sent.`;
    if (r.failureReason) return `The licence did not go through: ${r.failureReason}`;
    return `Licensed record ${r.recordId} from ${to} for ${r.price} MON.${r.hash ? `\nTransaction: ${r.hash}` : ''}\n${r.recordUrl}`;
  }
}

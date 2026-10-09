import {
  type CommandIO, InputFieldType, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags,
} from '@metamask/agent-wallet/plugin';
import { MONAD_TESTNET, planPayment, type PaymentPlan } from '../../lib/payment.ts';
import { who } from '../../lib/format.ts';
import { executorRequest } from '../../lib/submit.ts';

/**
 * Pay the person who made an image.
 *
 * A Grain creator's account is an ordinary EOA, derived from their passkey, so
 * the same address can receive on any EVM chain. Payments default to Monad
 * testnet, where the registry lives, and go through MetaMask's own policy-gated
 * executor; --chain-id sends on any other chain the wallet supports.
 */

const inputs = {
  target: {
    type: InputFieldType.Text, flag: 'target', index: 0, required: true, prompt: true,
    message: 'The image (path or URL) whose creator to pay, or a Grain record number',
  },
  amount: {
    type: InputFieldType.Text, flag: 'amount', index: 1, required: true, prompt: true,
    message: "Amount in the chain's native token, e.g. 0.5 (MON on Monad)",
  },
  chainId: {
    type: InputFieldType.Text, flag: 'chain-id', required: false, prompt: false,
    message: 'Chain to pay on (default 10143, Monad testnet, where the registry lives). Run `mm chains list` for options',
  },
  dryRun: {
    type: InputFieldType.Boolean, flag: 'dry-run', required: false, prompt: false,
    message: 'Find the creator and show the transaction without sending it',
  },
} satisfies InputSchema;

type PayResult = PaymentPlan & { sent: boolean; status?: string; hash?: string; failureReason?: string };

export default class GrainPay extends PluginCommand<PayResult> {
  static override description =
    'Pay the creator of an image, found from the image itself. Refuses forged or uncertain matches.';

  static override examples = [
    '<%= config.bin %> grain pay ./photo.jpg 0.5',
    '<%= config.bin %> grain pay 510 1 --dry-run --json',
    '<%= config.bin %> grain pay https://example.com/art.png 0.25 --chain-id 143   # pay on Monad mainnet',
  ];

  // Sending needs a signed-in, initialised MetaMask wallet: both defaults stay on.
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = 'grain:pay';

  async execute(io: CommandIO): Promise<PayResult> {
    const { target, amount, chainId, dryRun } = await io.resolveInputs(inputs);
    const plan = await planPayment(String(target), String(amount), chainId ? Number(chainId) : MONAD_TESTNET, (l) => io.progress(l));
    if (dryRun) return { ...plan, sent: false };

    const executor = await this.ctx.walletExecutor(io, 'grain:pay');
    const result = (await executor(
      (await executorRequest(plan.chainId, plan.transaction)) as never,
      { signal: io.signal } as never,
    )) as { status?: string; hash?: string; failureDescription?: string };
    return { ...plan, sent: true, status: result.status, hash: result.hash, failureReason: result.failureDescription };
  }

  override successHint(r: PayResult): string {
    const to = who({ creatorHandle: r.creatorHandle ?? undefined, creator: r.creator });
    if (!r.sent) return `Would send ${r.amount} on chain ${r.chainId} to ${to} (${r.creator}), the creator of record ${r.recordId}. Nothing was sent.`;
    if (r.failureReason) return `Payment to ${to} did not go through: ${r.failureReason}`;
    return `Sent ${r.amount} on chain ${r.chainId} to ${to}, the creator of record ${r.recordId}.${r.hash ? `\nTransaction: ${r.hash}` : ''}`;
  }
}

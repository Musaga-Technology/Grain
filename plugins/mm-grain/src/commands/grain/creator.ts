import {
  type CommandIO, InputFieldType, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags,
} from '@metamask/agent-wallet/plugin';
import { creatorByHandle, SITE, type CreatorListing } from '../../lib/grain.ts';

const inputs = {
  handle: { type: InputFieldType.Text, flag: 'handle', index: 0, required: true, prompt: true, message: 'Creator handle, e.g. grain-samples' },
} satisfies InputSchema;

type CreatorResult = CreatorListing & { url: string };

export default class GrainCreator extends PluginCommand<CreatorResult> {
  static override description = "List a creator's registered images. Served by Grain's Envio indexer: the contracts alone cannot list them.";
  static override examples = ['<%= config.bin %> grain creator grain-samples', '<%= config.bin %> grain creator @grain-samples --json'];
  static override requiresAuth = false;
  static override requiresInit = false;
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = 'grain:creator';

  async execute(io: CommandIO): Promise<CreatorResult> {
    const handle = String((await io.resolveInputs(inputs)).handle).replace(/^@/, '').toLowerCase();
    const c = await creatorByHandle(handle);
    if (c === 'unavailable') throw new Error("Grain's indexer isn't answering right now. Records are still on chain: `mm grain record <id>` works.");
    if (!c) throw new Error(`Nobody has registered under @${handle}.`);
    return { ...c, url: `${SITE}/c/${c.handle}` };
  }

  override successHint(c: CreatorResult): string {
    const ids = c.records.slice(0, 10).map((r) => `#${r.recordId}`).join(', ');
    return `@${c.handle} (${c.address}) has registered ${c.recordCount} image${c.recordCount === 1 ? '' : 's'}${ids ? `, latest ${ids}` : ''}.\n${c.url}`;
  }
}

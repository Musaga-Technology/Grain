import {
  type CommandIO, InputFieldType, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags,
} from '@metamask/agent-wallet/plugin';
import { formatEther } from 'viem';
import { handleOf, indexedRecord, licencePrice, licencesFor, readRecord } from '../../lib/grain.ts';
import { recordJson, who } from '../../lib/format.ts';

const inputs = {
  recordId: { type: InputFieldType.Text, flag: 'id', index: 0, required: true, prompt: true, message: 'Grain record number' },
} satisfies InputSchema;

type RecordResult = ReturnType<typeof recordJson> & {
  blockNumber: number | null; txHash: string | null;
  /** In MON; null when the creator has not made it licensable. */
  licencePrice: string | null;
  /** Licences granted so far; null if the indexer could not be reached. */
  licences: number | null;
};

export default class GrainRecord extends PluginCommand<RecordResult> {
  static override description = 'Look up a Grain record: who registered it, when, and whether it still stands.';
  static override examples = ['<%= config.bin %> grain record 510', '<%= config.bin %> grain record 510 --json'];
  static override requiresAuth = false;
  static override requiresInit = false;
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = 'grain:record';

  async execute(io: CommandIO): Promise<RecordResult> {
    const raw = String((await io.resolveInputs(inputs)).recordId).replace(/^#/, '');
    if (!/^\d+$/.test(raw)) throw new Error('A record number is digits only, like 510.');
    // The record itself always comes from contract storage; the indexer only
    // adds where it was registered, which storage does not keep.
    const id = BigInt(raw);
    const [rec, indexed, price, licences] = await Promise.all([
      readRecord(id), indexedRecord(id), licencePrice(id).catch(() => 0n), licencesFor(id),
    ]);
    if (!rec) throw new Error(`No record ${raw}: nothing has been registered under that number.`);
    rec.creatorHandle = await handleOf(rec.creator);
    return {
      ...recordJson(rec), blockNumber: indexed?.blockNumber ?? null, txHash: indexed?.txHash ?? null,
      licencePrice: price > 0n ? formatEther(price) : null, licences: licences?.length ?? null,
    };
  }

  override successHint(r: RecordResult): string {
    const state = r.revoked ? ' It has been withdrawn by its creator.' : r.supersededBy ? ` It was superseded by record ${r.supersededBy}.` : '';
    const licence = r.licencePrice
      ? ` Licensable for ${r.licencePrice} MON${r.licences ? ` (${r.licences} licence${r.licences === 1 ? '' : 's'} so far)` : ''}: mm grain license ${r.recordId}`
      : '';
    return `Record ${r.recordId}: made by ${who({ creatorHandle: r.creatorHandle ?? undefined, creator: r.creator })}, registered ${r.registeredAt}.${state}${licence}\n${r.url}`;
  }
}

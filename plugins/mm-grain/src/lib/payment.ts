/**
 * Who to pay, and the exact transaction -- everything in `mm grain pay` short
 * of sending. Kept apart from the command so it can be exercised without a
 * signed-in wallet.
 *
 * Paying the wrong person is the failure that matters, so this is strict: only
 * a clean RESOLVED match or an explicit record number pays. A forged watermark
 * (TAMPERED) or a close-but-not-exact match (UNCERTAIN) is refused.
 */
import { getAddress, parseEther, toHex } from 'viem';
import type { ResolvedRecord } from '../../../../packages/grain-core/src/index.ts';
import { handleOf, readRecord, verifyImage } from './grain.ts';
import { loadImage } from './image.ts';
import { decodeWatermark, loadDecoder } from './watermark.ts';
import { recordUrl, toResult } from './format.ts';

export const MONAD_MAINNET = 143;

export interface PaymentPlan {
  recordId: string;
  creator: string;
  creatorHandle: string | null;
  chainId: number;
  amount: string;
  transaction: { to: `0x${string}`; value: `0x${string}`; data: '0x' };
  recordUrl: string;
}

export async function planPayment(
  target: string, amount: string, chainId: number = MONAD_MAINNET,
  progress: (label?: string) => void = () => {},
): Promise<PaymentPlan> {
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error('--chain-id must be a positive integer.');
  let value: bigint;
  try { value = parseEther(amount); } catch { throw new Error(`"${amount}" is not an amount. Use a number like 0.5.`); }
  if (value <= 0n) throw new Error('The amount must be more than zero.');

  let record: ResolvedRecord | null;
  if (/^#?\d+$/.test(target)) {
    record = await readRecord(BigInt(target.replace('#', '')));
    if (!record) throw new Error(`No record ${target}.`);
  } else {
    await loadDecoder((file, mb) => progress(`Downloading the TrustMark ${file} model (${mb.toFixed(0)} MB, first run only)`));
    progress('Finding who made this image');
    const v = await verifyImage(await loadImage(target), decodeWatermark);
    progress();
    if (v.resolution.state !== 'RESOLVED') {
      throw new Error(`Not paying: ${toResult(v).summary}${v.resolution.state === 'UNCERTAIN' ? ' If you are sure, pay by record number instead.' : ''}`);
    }
    record = v.resolution.record;
  }
  if (record.revoked) throw new Error(`Not paying: record ${record.recordId} was withdrawn by its creator.`);
  record.creatorHandle ??= await handleOf(record.creator);

  return {
    recordId: record.recordId.toString(), creator: record.creator, creatorHandle: record.creatorHandle ?? null,
    chainId, amount, transaction: { to: getAddress(record.creator), value: toHex(value), data: '0x' }, recordUrl: recordUrl(record.recordId),
  };
}

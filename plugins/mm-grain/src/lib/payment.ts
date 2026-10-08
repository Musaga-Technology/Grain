/**
 * Who to pay, and the exact transaction -- everything in `mm grain pay` short
 * of sending. Kept apart from the command so it can be exercised without a
 * signed-in wallet.
 *
 * Paying the wrong person is the failure that matters, so this is strict: only
 * a clean RESOLVED match or an explicit record number pays. A forged watermark
 * (TAMPERED) or a close-but-not-exact match (UNCERTAIN) is refused.
 */
import { encodeFunctionData, formatEther, getAddress, parseEther, toHex } from 'viem';
import type { ResolvedRecord } from '../../../../packages/grain-core/src/index.ts';
import { handleOf, LICENSE_REGISTRY, licenceAbi as licenseAbi, licencePrice, readRecord, verifyImage } from './grain.ts';
import { loadImage } from './image.ts';
import { decodeWatermark, loadDecoder } from './watermark.ts';
import { recordUrl, toResult } from './format.ts';

/** Where the registry lives, and so where payments go by default. */
export const MONAD_TESTNET = 10143;

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
  target: string, amount: string, chainId: number = MONAD_TESTNET,
  progress: (label?: string) => void = () => {},
): Promise<PaymentPlan> {
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error('--chain-id must be a positive integer.');
  let value: bigint;
  try { value = parseEther(amount); } catch { throw new Error(`"${amount}" is not an amount. Use a number like 0.5.`); }
  if (value <= 0n) throw new Error('The amount must be more than zero.');

  const record = await findRecordStrict(target, progress);

  return {
    recordId: record.recordId.toString(), creator: record.creator, creatorHandle: record.creatorHandle ?? null,
    chainId, amount, transaction: { to: getAddress(record.creator), value: toHex(value), data: '0x' }, recordUrl: recordUrl(record.recordId),
  };
}

/**
 * The record a payment is for: an explicit record number, or the image's clean
 * RESOLVED match. Anything less certain is refused, with the reason.
 */
export async function findRecordStrict(target: string, progress: (label?: string) => void = () => {}): Promise<ResolvedRecord> {
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
      throw new Error(`Refused: ${toResult(v).summary}${v.resolution.state === 'UNCERTAIN' ? ' If you are sure, pay by record number instead.' : ''}`);
    }
    record = v.resolution.record;
  }
  if (record.revoked) throw new Error(`Refused: record ${record.recordId} was withdrawn by its creator.`);
  record.creatorHandle ??= await handleOf(record.creator);
  return record;

}

export interface LicencePlan {
  recordId: string;
  creator: string;
  creatorHandle: string | null;
  priceWei: string;
  price: string;
  chainId: number;
  transaction: { to: `0x${string}`; value: `0x${string}`; data: `0x${string}` };
  recordUrl: string;
}

/**
 * A licence through Grain's LicenseRegistry: the creator's listed price, paid
 * in full to them by the contract, and recorded on chain (and so in Envio) as
 * proof the licensee paid. Refused if the creator has set no price, or if the
 * price is above the caller's cap.
 */
export async function planLicence(
  target: string, maxPrice: string | undefined, progress: (label?: string) => void = () => {},
): Promise<LicencePlan> {
  let cap: bigint | undefined;
  if (maxPrice !== undefined) {
    try { cap = parseEther(maxPrice); } catch { throw new Error(`"${maxPrice}" is not an amount. Use a number like 0.05.`); }
  }
  const record = await findRecordStrict(target, progress);
  const price = await licencePrice(record.recordId);
  const who = record.creatorHandle ? `@${record.creatorHandle}` : record.creator;
  if (price === 0n) {
    throw new Error(`${who} has not set a licence price, so record ${record.recordId} cannot be licensed. You can still pay them directly: mm grain pay ${record.recordId} <amount>`);
  }
  if (cap !== undefined && price > cap) {
    throw new Error(`Not licensing: ${who} asks ${formatEther(price)} MON, above your --max-price of ${maxPrice}.`);
  }
  return {
    recordId: record.recordId.toString(), creator: getAddress(record.creator), creatorHandle: record.creatorHandle ?? null,
    priceWei: price.toString(), price: formatEther(price), chainId: MONAD_TESTNET,
    transaction: { to: LICENSE_REGISTRY, value: toHex(price), data: encodeFunctionData({ abi: licenseAbi, functionName: 'license', args: [record.recordId] }) },
    recordUrl: recordUrl(record.recordId),
  };
}

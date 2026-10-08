import { createPublicClient, http, parseAbi } from 'viem';
import { CONTRACTS } from '../../lib/chain';
import { activityEnabled, recordActivity, VERDICTS, type Verdict } from '../../lib/activity';

/** A check's outcome, reported by the browser that ran it. See lib/activity. */

const client = createPublicClient({ transport: http(process.env.RPC_TESTNET_ENDPOINT ?? process.env.NEXT_PUBLIC_RPC_URL) });
const registryAbi = parseAbi([
  'function records(uint64) view returns ((address creator, uint64 fingerprint, bytes32 manifestHash, uint40 registeredAt, uint64 supersededBy, bool revoked))',
]);

// A speed bump, not a guarantee: in-memory, so it resets with the instance.
const PER_MINUTE = 20;
const seen = new Map<string, number[]>();
function allowed(ip: string): boolean {
  const now = Date.now(), recent = (seen.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= PER_MINUTE) return false;
  recent.push(now); seen.set(ip, recent);
  if (seen.size > 5000) seen.clear();
  return true;
}

export async function POST(req: Request) {
  if (!activityEnabled()) return new Response(null, { status: 204 });
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  if (!allowed(ip)) return new Response(null, { status: 429 });

  const { recordId, verdict } = (await req.json().catch(() => ({}))) as { recordId?: string; verdict?: string };
  if (!recordId || !/^\d{1,12}$/.test(recordId) || !VERDICTS.includes(verdict as Verdict)) {
    return Response.json({ error: 'bad report' }, { status: 400 });
  }
  try {
    // The creator comes from the chain, never from the report.
    const r = await client.readContract({ address: CONTRACTS.GrainRegistry, abi: registryAbi, functionName: 'records', args: [BigInt(recordId)] });
    if (/^0x0+$/.test(r.creator)) return Response.json({ error: 'no such record' }, { status: 404 });
    await recordActivity(r.creator, recordId, verdict as Verdict);
    return new Response(null, { status: 204 });
  } catch (e) {
    // Telemetry must never surface as an error to the person checking.
    console.warn('activity report not stored', e);
    return new Response(null, { status: 204 });
  }
}

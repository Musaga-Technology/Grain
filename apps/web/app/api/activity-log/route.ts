import { eventsInWindow } from '../../lib/activity';
import { canonicalLog } from '../../lib/seal-format';

/**
 * The published log for one sealed window, line by line, for anyone to hash
 * and compare against the seal on Monad (see lib/seal-format for the format).
 * Each line names a creator's address, a record and a verdict -- nothing about
 * who ran the check.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const from = Number(q.get('from')), until = Number(q.get('until'));
  if (!Number.isInteger(from) || !Number.isInteger(until) || until < from) {
    return Response.json({ error: 'from and until must be unix seconds, until >= from' }, { status: 400 });
  }
  try {
    const lines = canonicalLog(await eventsInWindow(from, until)).split('\n').filter(Boolean);
    return Response.json({ from, until, lines }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ error: 'the log could not be read just now' }, { status: 503 });
  }
}

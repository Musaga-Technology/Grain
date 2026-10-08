import 'server-only';
import { list, put } from '@vercel/blob';
import type { LogEvent } from './seal-format';

/**
 * What happens to a creator's work while they are away: how often it is
 * checked, and when someone tries to pass off a forged credential.
 *
 * Privacy first. A report carries a record number and a verdict, nothing else:
 * never the image, never its fingerprint, never who checked it. The creator is
 * read from the chain by record number, so a report cannot be pinned on someone
 * by naming them.
 *
 * Storage is one one-byte blob per event (Blob refuses empty bodies), named for what happened --
 * activity/<creator>/<recordId>-<unix>-<verdict>-<nonce> -- so a single list
 * call reads a creator's history and no write ever races another. It is
 * telemetry reported by visitors' browsers, not something proven on chain, and
 * the creator page says so.
 */

export type Verdict = 'RESOLVED' | 'UNCERTAIN' | 'TAMPERED';
export const VERDICTS: Verdict[] = ['RESOLVED', 'UNCERTAIN', 'TAMPERED'];

export interface ActivityEvent { recordId: string; at: number; verdict: Verdict }

export const activityEnabled = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

// Local and preview builds share production's store; keep their test checks
// out of real creators' activity.
const ROOT = process.env.VERCEL_ENV === 'production' ? 'activity' : 'activity-dev';

export async function recordActivity(creator: string, recordId: string, verdict: Verdict): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const nonce = Math.random().toString(36).slice(2, 8);
  await put(`${ROOT}/${creator.toLowerCase()}/${recordId}-${now}-${verdict}-${nonce}`, '1', {
    access: 'private', addRandomSuffix: false, contentType: 'text/plain',
  });
}

async function readActivity(creator: string): Promise<ActivityEvent[]> {
  const events: ActivityEvent[] = [];
  let cursor: string | undefined;
  // Newest are what matter; 2,000 events is plenty for a creator page.
  for (let page = 0; page < 2; page++) {
    const res = await list({ prefix: `${ROOT}/${creator.toLowerCase()}/`, limit: 1000, cursor });
    for (const b of res.blobs) {
      const m = b.pathname.match(/\/(\d+)-(\d+)-(RESOLVED|UNCERTAIN|TAMPERED)-/);
      if (m) events.push({ recordId: m[1], at: Number(m[2]), verdict: m[3] as Verdict });
    }
    if (!res.hasMore) break;
    cursor = res.cursor;
  }
  return events.sort((a, b) => b.at - a.at);
}

/**
 * Not cached here: the creator page regenerates every 30 s (ISR), which bounds
 * the list calls, and a second cache layer only made the page later.
 */
export const activityFor = (creator: string) => readActivity(creator).catch(() => null);

/**
 * Every event, across all creators, in the window (from, until] -- what one
 * seal covers. Throws rather than returning a partial list: sealing an
 * incomplete window would make an honest log look tampered with.
 */
export async function eventsInWindow(from: number, until: number): Promise<LogEvent[]> {
  const events: LogEvent[] = [];
  let cursor: string | undefined;
  do {
    const res = await list({ prefix: `${ROOT}/`, limit: 1000, cursor });
    for (const b of res.blobs) {
      const m = b.pathname.match(/^[^/]+\/(0x[0-9a-f]{40})\/(\d+)-(\d+)-(RESOLVED|UNCERTAIN|TAMPERED)-([a-z0-9]+)$/);
      if (!m) continue;
      const at = Number(m[3]);
      if (at > from && at <= until) events.push({ creator: m[1], recordId: m[2], at, verdict: m[4], nonce: m[5] });
    }
    cursor = res.hasMore ? res.cursor : undefined;
  } while (cursor);
  return events;
}

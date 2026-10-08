'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

/**
 * A creator's activity: their work being checked, and forgeries caught. The
 * "new since your last visit" count is the reason to come back, so the last
 * visit is kept in this browser -- nothing about who views a page is sent
 * anywhere.
 */

export interface ActivityItem { recordId: string; at: number; verdict: 'RESOLVED' | 'UNCERTAIN' | 'TAMPERED' }

const WEEK = 7 * 86400;

function ago(at: number, now: number): string {
  const s = Math.max(0, now - at);
  const unit = (n: number, u: string) => `${n} ${u}${n === 1 ? '' : 's'} ago`;
  if (s < 90) return 'moments ago';
  if (s < 3600) return unit(Math.floor(s / 60), 'minute');
  if (s < 86400) return unit(Math.floor(s / 3600), 'hour');
  return unit(Math.floor(s / 86400), 'day');
}

export function Activity({ handle, events }: { handle: string; events: ActivityItem[] }) {
  const [now, setNow] = useState<number | null>(null);
  const [lastSeen, setLastSeen] = useState<number | null>(null);
  useEffect(() => {
    const key = `grain:seen:${handle}`;
    const t = Math.floor(Date.now() / 1000);
    setNow(t);
    try {
      const prev = Number(localStorage.getItem(key) ?? 0);
      setLastSeen(prev || null);
      // Mark as seen only what this page actually showed: the newest event on
      // it, not the time now. The list can be a few seconds behind, and
      // stamping "now" would silently swallow an event the creator never saw.
      // With nothing shown yet, the visit itself is the baseline.
      const newest = events[0]?.at ?? t;
      localStorage.setItem(key, String(Math.max(prev, newest)));
    } catch { /* private mode: no badge, nothing breaks */ }
  }, [handle, events]);

  const ref = now ?? events[0]?.at ?? 0;
  const week = events.filter((e) => e.at > ref - WEEK);
  const forgeries = events.filter((e) => e.verdict === 'TAMPERED');
  const fresh = lastSeen ? events.filter((e) => e.at > lastSeen).length : 0;

  return (
    <section className="mt-12">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-medium">Activity</h2>
        {fresh > 0 && (
          <span className="rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ background: 'var(--brand)', color: 'var(--paper)' }}>
            {fresh} new since your last visit
          </span>
        )}
      </div>
      <p className="mt-2 text-[15px]" style={{ color: 'var(--ink-muted)' }}>
        {events.length === 0
          ? 'No checks of this work reported yet. Each time someone checks a copy, it shows up here.'
          : <>Checked <strong style={{ color: 'var(--ink)' }}>{week.length}</strong> {week.length === 1 ? 'time' : 'times'} this week
              {' '}&middot; <strong style={{ color: 'var(--ink)' }}>{events.length}</strong> in all
              {forgeries.length > 0 && <> &middot; <strong style={{ color: 'var(--accent)' }}>{forgeries.length}</strong> forged {forgeries.length === 1 ? 'copy' : 'copies'} caught</>}</>}
      </p>
      {events.length > 0 && (
        <ul className="mt-4 divide-y rounded-lg border" style={{ borderColor: 'var(--rule)' }}>
          {events.slice(0, 8).map((e, i) => (
            <li key={`${e.recordId}-${e.at}-${i}`} className="flex items-center justify-between gap-4 px-4 py-3 text-[14px]"
                style={{ borderColor: 'var(--rule)' }}>
              <span>
                {e.verdict === 'TAMPERED'
                  ? <><span style={{ color: 'var(--accent)' }}>Forgery caught</span>: someone used your mark on a different picture, record </>
                  : <>A copy of record </>}
                <Link href={`/r/${e.recordId}`} className="underline underline-offset-4">#{e.recordId}</Link>
                {e.verdict === 'TAMPERED' ? '' : e.verdict === 'UNCERTAIN' ? ' was checked (heavily edited)' : ' was checked and credited to you'}
                {lastSeen && e.at > lastSeen && <span className="ml-2 text-xs" style={{ color: 'var(--brand)' }}>new</span>}
              </span>
              <span className="shrink-0 text-xs" style={{ color: 'var(--ink-faint)' }}>{now ? ago(e.at, now) : ''}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs" style={{ color: 'var(--ink-faint)' }}>
        Reported by the browsers that ran each check: a record number and a verdict, never the image.
      </p>
    </section>
  );
}

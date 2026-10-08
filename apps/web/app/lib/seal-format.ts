import { keccak256, toBytes } from 'viem';

/**
 * The exact bytes a seal commits to. Shared by the server that seals and the
 * browser that checks, so both hash the same thing, and spelled out so anyone
 * can reproduce it without this code:
 *
 *   one line per event:  <creator>|<recordId>|<unix seconds>|<verdict>|<nonce>
 *   creator lowercase, lines sorted, joined with "\n", no trailing newline,
 *   UTF-8, keccak256. An empty window hashes the empty string.
 */
export interface LogEvent { creator: string; recordId: string; at: number; verdict: string; nonce: string }

export const logLine = (e: LogEvent) => `${e.creator.toLowerCase()}|${e.recordId}|${e.at}|${e.verdict}|${e.nonce}`;

export function canonicalLog(events: LogEvent[]): string {
  return events.map(logLine).sort().join('\n');
}

export function logRoot(lines: string[]): `0x${string}` {
  return keccak256(toBytes([...lines].sort().join('\n')));
}

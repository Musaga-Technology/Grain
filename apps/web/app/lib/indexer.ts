/**
 * The Envio indexer, as the app's primary read path.
 *
 * The chain stays the source of truth (SPEC.md §7): every function here has a
 * chain fallback or degrades honestly, so the product keeps working with the
 * indexer down. But some things are only practical through the indexer --
 * listing a creator's records, or what was registered most recently, would mean
 * scanning every record on chain -- and the rest are an order of magnitude
 * faster: the candidate fan-out is one 90 ms query instead of eight chain reads
 * at 980 ms.
 */

const ENDPOINT = process.env.NEXT_PUBLIC_ENVIO_GRAPHQL_URL;
const TIMEOUT_MS = 4000;

export function indexerConfigured(): boolean {
  return Boolean(ENDPOINT);
}

/** Null on any failure: callers fall back rather than break. */
async function query<T>(q: string, variables: Record<string, unknown> = {}): Promise<T | null> {
  if (!ENDPOINT) return null;
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: q, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Server components: a few seconds of staleness is fine for listings.
      next: { revalidate: 15 },
    } as RequestInit);
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: T; errors?: unknown };
    return body.errors ? null : (body.data ?? null);
  } catch {
    return null;
  }
}

export interface IndexedRecord {
  recordId: string;
  creator: string;
  fingerprint: string; // decimal string, as the indexer stores BigInt
  registeredAt: number;
  blockNumber: number;
  txHash: string;
  manifest: string; // hex CBOR
  revoked: boolean;
  supersededBy: string | null;
  creatorEntity?: { handle: string | null } | null;
}

const RECORD_FIELDS = `recordId creator fingerprint registeredAt blockNumber txHash manifest revoked supersededBy
  creatorEntity { handle }`;

/** One indexed lookup over the 8 LSH band keys -- the fan-out the indexer exists for. */
export async function candidatesByBands(keys: string[]): Promise<IndexedRecord[] | null> {
  const data = await query<{ FingerprintBand: { record: IndexedRecord }[] }>(
    `query($keys:[String!]!){ FingerprintBand(where:{key:{_in:$keys}, revoked:{_eq:false}}){ record { ${RECORD_FIELDS} } } }`,
    { keys },
  );
  if (!data) return null;
  const seen = new Map<string, IndexedRecord>();
  for (const b of data.FingerprintBand) seen.set(b.record.recordId, b.record);
  return [...seen.values()];
}

export async function recordById(recordId: string): Promise<IndexedRecord | null> {
  const data = await query<{ Record: IndexedRecord[] }>(
    `query($id:String!){ Record(where:{id:{_eq:$id}}){ ${RECORD_FIELDS} } }`, { id: recordId },
  );
  return data?.Record[0] ?? null;
}

/** Licences granted for a record. Only the indexer keeps the list; the contract keeps a yes/no per licensee. */
export async function licencesFor(recordId: string): Promise<{ licensee: string; amountWei: string; grantedAt: number }[] | null> {
  const data = await query<{ License: { licensee: string; amountWei: string; grantedAt: number }[] }>(
    `query($id:numeric!){ License(where:{recordId:{_eq:$id}}, order_by:{grantedAt:desc}){ licensee amountWei grantedAt } }`,
    { id: recordId },
  );
  return data?.License ?? null;
}

export async function recentRecords(limit = 6): Promise<IndexedRecord[] | null> {
  const data = await query<{ Record: IndexedRecord[] }>(
    `query($n:Int!){ Record(order_by:{recordId:desc}, limit:$n, where:{revoked:{_eq:false}}){ ${RECORD_FIELDS} } }`,
    { n: limit },
  );
  return data?.Record ?? null;
}

export interface CreatorPage {
  address: string;
  handle: string;
  recordCount: number;
  records: IndexedRecord[];
}

export async function creatorByHandle(handle: string): Promise<CreatorPage | null | 'unavailable'> {
  const data = await query<{ Creator: { id: string; handle: string; recordCount: number; records: IndexedRecord[] }[] }>(
    `query($h:String!){ Creator(where:{handle:{_eq:$h}}){ id handle recordCount
       records(order_by:{recordId:desc}, limit:60){ ${RECORD_FIELDS} } } }`,
    { h: handle },
  );
  if (data === null) return 'unavailable';
  const c = data.Creator[0];
  return c ? { address: c.id, handle: c.handle, recordCount: c.recordCount, records: c.records } : null;
}

export async function registryStats(): Promise<{ records: number; creators: number } | null> {
  const data = await query<{ Record: { recordId: string }[]; Creator: { id: string }[] }>(
    `{ Record(order_by:{recordId:desc}, limit:1){ recordId } Creator(where:{handle:{_is_null:false}}){ id } }`,
  );
  if (!data) return null;
  return { records: Number(data.Record[0]?.recordId ?? 0), creators: data.Creator.length };
}

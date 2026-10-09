/**
 * The Envio indexer, as the app's primary read path.
 *
 * The chain stays the source of truth: every function here has a
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

/**
 * Accounts made while testing the app -- including two early test records that
 * put a made-up name on stock photos. Testnet records cannot be deleted, so
 * they are left out of the landing page's feed and creator count instead. They
 * still resolve, and their record pages still work: this hides them from a
 * showcase, it does not rewrite the registry.
 */
const TEST_ACCOUNTS = [
  '0x22d14611bb72b8c55eb06a45aa5fbac6d079ca54', // record 507
  '0x1661ac48eda15b7aadfa4dd820c56dee568589ce', // record 508
  '0x4b5df5d9844cc7e21aa2dd1cc00d64da97ddf572', // @grain-qa, record 509
  '0x26ee0db5dcd47623b9c7f515fa2df1e85f9355c5', // record 512
  '0x82787b32e380fa5f5602547841fbd080080f9506', // record 513
  '0x97f33c2e1813114b38e5c5ae5c208fd055e5e461', // name only
  '0x36d21668c918fdb18478991d17307520c5727513', // name only
  '0x23da2c297799cdf7a5cb1b61ac7560b8933da6e9', // name only
  '0x31c7b16f59f1c5f5687ef27ba02aa7ae91fe1562', // @grain-batch-test
  '0x19870645f6a7fefb8a6afb0a0ce3d705c495dfdb', // @grain-single-test
  // Mera test runs: names, pen names, and registrations whose naming step failed
  '0x5fc0336e53d946c11e81c649938e9fda6ad236c6', // (no name) record 518
  '0x4633705fd7f384b2e36e03ed018c261400fe8943', // @night-shift-test
  '0xb002e4fa7f17bec766b0d55669b0d4bb80ffcb8b', // @grain-mera-check
  '0xe97d8a77958780eacf8b8bc15cba08b3d773c5db', // (no name) record 521
  '0xf3cd09867b63a042199953027c7c002157299238', // @grain-mera-final
  '0x0716ff7d5dfb9d559600b912d581f6892e93876a', // (no name) record 523
  '0x46d0c575d618f1d7dc7c2b0a264ce2da481c9a93', // @grain-mera-final-46d0
  '0x88715d53364d27b9cc2cd8b4a773f81c4a33ffe7', // (no name) record 525
  '0xfe421a10a477a1eda8931b8732fbfddca994f5bd', // @grain-mera-run
  '0x8705e31b214fe76b6aac9d8269ba72c561ea8b59', // @night-shift-run
  '0x47a450751c74f6bfced7a4f3d223c14cc9a0840f', // @grain-mera-demo
  '0x35de9bfda0175b0a95d8c6d12919f0b8987aa5e7', // @night-shift-demo
];

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
    `query($n:Int!, $hide:[String!]!){ Record(order_by:{recordId:desc}, limit:$n,
       where:{revoked:{_eq:false}, creator:{_nin:$hide}}){ ${RECORD_FIELDS} } }`,
    { n: limit, hide: TEST_ACCOUNTS },
  );
  return data?.Record ?? null;
}

export interface IndexedLicence {
  recordId: string;
  licensee: string;
  amountWei: string;
  grantedAt: number;
  txHash: string;
}

export interface CreatorPage {
  address: string;
  handle: string;
  recordCount: number;
  records: IndexedRecord[];
  licencePriceWei: string;
  /** Every licence sold, newest first: the creator's earnings, straight from the chain's events. */
  licences: IndexedLicence[];
}

export async function creatorByHandle(handle: string): Promise<CreatorPage | null | 'unavailable'> {
  const data = await query<{ Creator: { id: string; handle: string; recordCount: number; licensePriceWei: string; records: IndexedRecord[] }[] }>(
    `query($h:String!){ Creator(where:{handle:{_eq:$h}}){ id handle recordCount licensePriceWei
       records(order_by:{recordId:desc}, limit:60){ ${RECORD_FIELDS} } } }`,
    { h: handle },
  );
  if (data === null) return 'unavailable';
  const c = data.Creator[0];
  if (!c) return null;
  // A second query rather than a relation: License is keyed by the creator's
  // address, and the schema keeps it a flat table for the plugin's lookups.
  const lic = await query<{ License: IndexedLicence[] }>(
    `query($c:String!){ License(where:{creator:{_eq:$c}}, order_by:{grantedAt:desc}){ recordId licensee amountWei grantedAt txHash } }`,
    { c: c.id.toLowerCase() },
  );
  return {
    address: c.id, handle: c.handle, recordCount: c.recordCount, records: c.records,
    licencePriceWei: c.licensePriceWei, licences: lic?.License ?? [],
  };
}

/** A creator's page by address -- for "Your work", where the addresses come from the passkey. */
export async function creatorByAddress(address: string): Promise<CreatorPage | null | 'unavailable'> {
  const data = await query<{ Creator: { handle: string | null }[] }>(
    `query($a:String!){ Creator(where:{id:{_eq:$a}}){ handle } }`, { a: address.toLowerCase() },
  );
  if (data === null) return 'unavailable';
  const handle = data.Creator[0]?.handle;
  if (handle) return creatorByHandle(handle);
  // Records but no name yet: list them directly.
  const recs = await query<{ Record: IndexedRecord[] }>(
    `query($a:String!){ Record(where:{creator:{_eq:$a}}, order_by:{recordId:desc}, limit:60){ ${RECORD_FIELDS} } }`, { a: address.toLowerCase() },
  );
  if (!recs) return 'unavailable';
  return recs.Record.length
    ? { address: address.toLowerCase(), handle: '', recordCount: recs.Record.length, records: recs.Record, licencePriceWei: '0', licences: [] }
    : null;
}

export async function registryStats(): Promise<{ records: number; creators: number } | null> {
  const data = await query<{ Record: { recordId: string }[]; Creator: { id: string }[] }>(
    `query($hide:[String!]!){ Record(order_by:{recordId:desc}, limit:1){ recordId }
       Creator(where:{handle:{_is_null:false}, id:{_nin:$hide}}){ id } }`,
    { hide: TEST_ACCOUNTS },
  );
  if (!data) return null;
  return { records: Number(data.Record[0]?.recordId ?? 0), creators: data.Creator.length };
}

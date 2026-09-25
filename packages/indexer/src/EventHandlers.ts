import { indexer } from 'envio';

/**
 * Grain indexer handlers.
 *
 * The chain is the source of truth; this is a read accelerator. SPEC.md §7
 * requires the resolver to keep answering with the indexer down, so nothing
 * here may become load-bearing for correctness -- only for speed.
 */

const BANDS = 8;

/**
 * Split a 64-bit fingerprint into its 8 LSH bands, band 0 being the most
 * significant byte.
 *
 * MUST MATCH grain-core's toBands exactly. If these drift, the candidate
 * fan-out silently stops returning records that the chain-read path would
 * find -- a failure that looks like "the fingerprint path just doesn't match"
 * rather than like a bug. The invariant is asserted in test/bands.test.ts.
 */
function toBands(fingerprint: bigint): number[] {
  const out: number[] = [];
  for (let i = BANDS - 1; i >= 0; i--) {
    out.push(Number((fingerprint >> BigInt(i * 8)) & 0xffn));
  }
  return out;
}

const bandId = (band: number, value: number, recordId: bigint) => `${band}:${value}:${recordId}`;
/** What a candidate query looks up. One indexed key per band value. */
const bandKey = (band: number, value: number) => `${band}:${value}`;

indexer.onEvent(
  { contract: 'GrainRegistry', event: 'ManifestRegistered' },
  async ({ event, context }) => {
    const recordId = event.params.recordId;
    const id = recordId.toString();
    const creator = event.params.creator.toLowerCase();

    context.Record.set({
      id,
      recordId,
      creator,
      creatorEntity_id: creator,
      fingerprint: event.params.fingerprint,
      manifestHash: event.params.manifestHash,
      // The full CBOR only ever exists in the event. Decoding it here is what
      // makes it queryable without replaying logs.
      manifest: event.params.manifest,
      registeredAt: Number(event.block.timestamp),
      blockNumber: Number(event.block.number),
      txHash: event.transaction.hash,
      supersededBy: undefined,
      revoked: false,
    });

    // Eight rows rather than an array column, so the fan-out is an indexed key
    // lookup rather than an array scan. See schema.graphql.
    toBands(event.params.fingerprint).forEach((value, band) => {
      context.FingerprintBand.set({
        id: bandId(band, value, recordId),
        key: bandKey(band, value),
        band,
        value,
        record_id: id,
        revoked: false,
      });
    });

    const existing = await context.Creator.get(creator);
    context.Creator.set({
      id: creator,
      address: creator,
      handle: existing?.handle,
      profileURI: existing?.profileURI,
      licensePriceWei: existing?.licensePriceWei ?? 0n,
      recordCount: (existing?.recordCount ?? 0) + 1,
    });
  },
);

indexer.onEvent(
  { contract: 'GrainRegistry', event: 'ManifestSuperseded' },
  async ({ event, context }) => {
    const old = await context.Record.get(event.params.oldId.toString());
    // Supersession does not revoke: the earlier version stays resolvable, it
    // just points forward. A creator who edited an image has not disowned the
    // original.
    if (old) context.Record.set({ ...old, supersededBy: event.params.newId });
  },
);

indexer.onEvent(
  { contract: 'GrainRegistry', event: 'ManifestRevoked' },
  async ({ event, context }) => {
    const record = await context.Record.get(event.params.recordId.toString());
    if (!record) return;

    context.Record.set({ ...record, revoked: true });

    // Denormalised onto the band rows so a fan-out can filter revoked records
    // without joining back to Record.
    toBands(record.fingerprint).forEach((value, band) => {
      context.FingerprintBand.set({
        id: bandId(band, value, record.recordId),
        key: bandKey(band, value),
        band,
        value,
        record_id: record.id,
        revoked: true,
      });
    });
  },
);

indexer.onEvent(
  { contract: 'CreatorRegistry', event: 'ProfileSet' },
  async ({ event, context }) => {
    const id = event.params.creator.toLowerCase();
    const existing = await context.Creator.get(id);
    context.Creator.set({
      id,
      address: id,
      handle: event.params.handle,
      profileURI: existing?.profileURI,
      licensePriceWei: event.params.licensePriceWei,
      recordCount: existing?.recordCount ?? 0,
    });
  },
);

indexer.onEvent(
  { contract: 'LicenseRegistry', event: 'LicenseGranted' },
  async ({ event, context }) => {
    context.License.set({
      id: `${event.params.recordId}:${event.params.licensee.toLowerCase()}:${event.transaction.hash}`,
      recordId: event.params.recordId,
      licensee: event.params.licensee.toLowerCase(),
      creator: event.params.creator.toLowerCase(),
      amountWei: event.params.amountWei,
      grantedAt: Number(event.params.grantedAt),
      txHash: event.transaction.hash,
    });
  },
);

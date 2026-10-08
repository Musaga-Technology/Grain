/**
 * Deterministic CBOR encoder (RFC 8949 §4.2, "core deterministic encoding").
 *
 * Owned rather than pulled from a general CBOR library for the same reason the
 * DCT table and the resize are owned: the manifest hash is what the chain
 * stores and what the signature covers, so two encoders disagreeing about map
 * ordering or integer width would produce a manifest that fails verification
 * while looking correct.
 *
 * The rules that matter here:
 *  - integers use the shortest form that fits
 *  - map keys are sorted by their encoded bytes, length first then lexically
 *  - no indefinite-length items
 *
 * Only the subset the manifest needs is implemented. Anything else throws,
 * because silently encoding an unexpected type would change the hash.
 */

export type CborValue =
  | number | bigint | string | boolean | null
  | Uint8Array | CborValue[] | { [k: string]: CborValue | undefined };

function head(major: number, value: bigint): Uint8Array {
  const mt = major << 5;
  if (value < 24n) return Uint8Array.from([mt | Number(value)]);
  if (value < 0x100n) return Uint8Array.from([mt | 24, Number(value)]);
  if (value < 0x10000n) {
    return Uint8Array.from([mt | 25, Number(value >> 8n) & 0xff, Number(value) & 0xff]);
  }
  if (value < 0x100000000n) {
    const b = new Uint8Array(5);
    b[0] = mt | 26;
    new DataView(b.buffer).setUint32(1, Number(value));
    return b;
  }
  const b = new Uint8Array(9);
  b[0] = mt | 27;
  new DataView(b.buffer).setBigUint64(1, value);
  return b;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

/** Sorted by encoded-key bytes: shorter first, then bytewise. RFC 8949 §4.2.1. */
function compareKeys(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return a.length - b.length;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export function encodeCbor(value: CborValue): Uint8Array {
  if (value === null) return Uint8Array.from([0xf6]);
  if (typeof value === 'boolean') return Uint8Array.from([value ? 0xf5 : 0xf4]);

  if (typeof value === 'bigint' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isInteger(value)) {
      throw new Error(`refusing to encode non-integer ${value}: floats are not deterministic here`);
    }
    const v = BigInt(value);
    return v >= 0n ? head(0, v) : head(1, -v - 1n);
  }

  if (typeof value === 'string') {
    const bytes = new TextEncoder().encode(value);
    return concat([head(3, BigInt(bytes.length)), bytes]);
  }

  if (value instanceof Uint8Array) {
    return concat([head(2, BigInt(value.length)), value]);
  }

  if (Array.isArray(value)) {
    return concat([head(4, BigInt(value.length)), ...value.map(encodeCbor)]);
  }

  if (typeof value === 'object') {
    // undefined members are omitted entirely rather than encoded as null:
    // an absent optional field and a null one must not hash the same.
    const entries = Object.entries(value).filter(([, v]) => v !== undefined) as [string, CborValue][];
    const encoded = entries
      .map(([k, v]) => ({ k: encodeCbor(k), v: encodeCbor(v) }))
      .sort((x, y) => compareKeys(x.k, y.k));
    return concat([head(5, BigInt(encoded.length)), ...encoded.flatMap((e) => [e.k, e.v])]);
  }

  throw new Error(`unsupported CBOR type: ${typeof value}`);
}

/**
 * Decoder for the same subset the encoder writes.
 *
 * Integers come back as bigint when they exceed Number's safe range, so a
 * uint64 recordId survives a round trip intact. Anything outside the subset
 * throws rather than guessing, for the same reason the encoder does.
 */
export function decodeCbor(bytes: Uint8Array): CborValue {
  let pos = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const readArg = (info: number): bigint => {
    if (info < 24) return BigInt(info);
    if (info === 24) return BigInt(bytes[pos++]);
    if (info === 25) { const v = view.getUint16(pos); pos += 2; return BigInt(v); }
    if (info === 26) { const v = view.getUint32(pos); pos += 4; return BigInt(v); }
    if (info === 27) { const v = view.getBigUint64(pos); pos += 8; return v; }
    throw new Error(`unsupported CBOR length encoding ${info}`);
  };
  const num = (v: bigint): number | bigint => (v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v);

  const item = (): CborValue => {
    if (pos >= bytes.length) throw new Error('truncated CBOR');
    const head = bytes[pos++];
    const major = head >> 5, info = head & 0x1f;
    switch (major) {
      case 0: return num(readArg(info));
      case 1: { const v = -1n - readArg(info); return v >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(v) : v; }
      case 2: { const n = Number(readArg(info)); const b = bytes.slice(pos, pos + n); pos += n; return b; }
      case 3: { const n = Number(readArg(info)); const s = new TextDecoder().decode(bytes.subarray(pos, pos + n)); pos += n; return s; }
      case 4: { const n = Number(readArg(info)); return Array.from({ length: n }, () => item()); }
      case 5: {
        const n = Number(readArg(info));
        const out: Record<string, CborValue> = {};
        for (let i = 0; i < n; i++) {
          const k = item();
          if (typeof k !== 'string') throw new Error('only text map keys are supported');
          out[k] = item();
        }
        return out;
      }
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        throw new Error(`unsupported CBOR simple value ${info}`);
      default:
        throw new Error(`unsupported CBOR major type ${major}`);
    }
  };

  const value = item();
  if (pos !== bytes.length) throw new Error('trailing bytes after CBOR value');
  return value;
}

import { keccak256, recoverMessageAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { encodeCbor, type CborValue } from './cbor.ts';
import { TRUSTMARK_ALG_ID } from './watermark.ts';

/**
 * C2PA-COMPATIBLE manifest.
 *
 * Compatible, not conformant: the soft binding assertion structure and the
 * Soft Binding Resolution API shape follow the spec, but this does not run the
 * c2pa-rs signing stack with X.509 certificates from the C2PA trust list. That
 * distinction is stated in the README verbatim: overclaiming to anyone who
 * knows the spec costs more than the gap does.
 */

export const GRAIN_PHASH_ALG = 'grain.phash.v1';
export const TRUSTMARK_ALG = 'com.adobe.trustmark.Q';

/** 0 means unregistered. grain.phash.v1 is ours and is NOT on the C2PA approved list. */
export const GRAIN_PHASH_ALG_ID = 0;

/**
 * How the asset was made, in C2PA's vocabulary: the digitalSourceType of the
 * c2pa.created action, drawn from the IPTC Digital Source Type list. Generated
 * media says so -- the track's own example is provenance for generated media,
 * and an honest registry must not let an AI image pass as a photograph.
 */
export const DIGITAL_SOURCE = {
  /** Made by a generative model, e.g. ChatGPT, Midjourney. */
  aiGenerated: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
  /** A camera capture. */
  camera: 'http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture',
  /** Made by a person with software: drawing, design, composites. */
  humanMade: 'http://cv.iptc.org/newscodes/digitalsourcetype/digitalCreation',
} as const;

export interface CreatedAssertion {
  digitalSourceType: string;
  /** The generating tool, for AI media, e.g. "ChatGPT". */
  softwareAgent?: string;
}

export const isAiGenerated = (m: { assertions?: { created?: CreatedAssertion } }) =>
  m.assertions?.created?.digitalSourceType === DIGITAL_SOURCE.aiGenerated;

/**
 * The AI agent that generated the asset, by its ERC-8004 identity: the
 * registry as a CAIP-10 account (eip155:<chain>:<address>) and the agent's id
 * there. A claim, not a proof on its own: readers check on chain that the
 * manifest's signer owns the agent or is its registered wallet.
 */
export interface AgentAssertion {
  registry: string;
  agentId: string;
}

/** ERC-8004's IdentityRegistry on every testnet, Monad testnet included (CREATE2). */
export const ERC8004_IDENTITY_TESTNET = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
export const ERC8004_REPUTATION_TESTNET = '0x8004B663056A597Dffe9eCcC1965A193B7388713';

export interface SoftBinding {
  alg: typeof TRUSTMARK_ALG | typeof GRAIN_PHASH_ALG;
  algId: number;
  value: Hex;
}

export interface GrainManifest {
  version: 1;
  recordId: bigint;
  creator: Hex;
  createdAt: number;
  assertions: {
    softBindings: SoftBinding[];
    title?: string;
    generator?: string;
    license?: { priceWei: bigint; terms: string };
    created?: CreatedAssertion;
    agent?: AgentAssertion;
  };
  private?: Hex;
  signature?: Hex;
}

export interface BuildManifestInput {
  recordId: bigint;
  creator: Hex;
  fingerprint: bigint;
  /** Omit when the asset carries no watermark, e.g. an aspect ratio past 2:1. */
  watermarked?: boolean;
  createdAt?: number;
  title?: string;
  generator?: string;
  license?: { priceWei: bigint; terms: string };
  created?: CreatedAssertion;
  agent?: AgentAssertion;
  private?: Hex;
}

function fingerprintHex(fp: bigint): Hex {
  return `0x${fp.toString(16).padStart(16, '0')}`;
}

/**
 * The manifest ALWAYS carries the fingerprint as a soft binding, even when a
 * watermark is present. That is what makes the anti-spoof cross-check possible
 *: at lookup, the fingerprint stored here is compared against one
 * computed from the watermark-bearing asset, and a mismatch means the mark was
 * transferred onto a different image.
 */
export function buildManifest(input: BuildManifestInput): GrainManifest {
  const softBindings: SoftBinding[] = [
    { alg: GRAIN_PHASH_ALG, algId: GRAIN_PHASH_ALG_ID, value: fingerprintHex(input.fingerprint) },
  ];
  if (input.watermarked !== false) {
    softBindings.push({
      alg: TRUSTMARK_ALG,
      algId: TRUSTMARK_ALG_ID,
      value: `0x${input.recordId.toString(16).padStart(16, '0')}`,
    });
  }

  return {
    version: 1,
    recordId: input.recordId,
    creator: input.creator,
    createdAt: input.createdAt ?? Math.floor(Date.now() / 1000),
    assertions: {
      softBindings,
      title: input.title,
      generator: input.generator,
      license: input.license,
      created: input.created,
      agent: input.agent,
    },
    private: input.private,
  };
}

/** CBOR bytes, signature excluded. This is what gets hashed and signed. */
export function encodeManifest(m: GrainManifest): Uint8Array {
  const { signature: _omitted, ...rest } = m;
  return encodeCbor(rest as unknown as CborValue);
}

/** CBOR bytes including the signature. This is what goes on chain. */
export function encodeSignedManifest(m: GrainManifest): Uint8Array {
  if (!m.signature) throw new Error('manifest is unsigned');
  return encodeCbor(m as unknown as CborValue);
}

export function manifestHash(m: GrainManifest): Hex {
  return keccak256(encodeManifest(m));
}

/** Anything that can produce an EIP-191 signature over a digest. */
export interface ManifestSigner {
  address: Hex;
  signMessage: (args: { message: { raw: Hex } }) => Promise<Hex>;
}

/**
 * EIP-191 personal_sign over keccak256(cbor(manifest without signature)).
 *
 * Takes a signer rather than a raw key, because the browser's signing key comes
 * from a passkey-derived session that never exposes its private key -- and
 * should not have to in order to sign a manifest.
 */
export async function signManifestWith(m: GrainManifest, signer: ManifestSigner): Promise<GrainManifest> {
  if (signer.address.toLowerCase() !== m.creator.toLowerCase()) {
    throw new Error(`signer does not match manifest creator: ${signer.address} vs ${m.creator}`);
  }
  const signature = await signer.signMessage({ message: { raw: manifestHash(m) } });
  return { ...m, signature };
}

/** Convenience wrapper for server-side and script use, where a key is in hand. */
export async function signManifest(m: GrainManifest, privateKey: Hex): Promise<GrainManifest> {
  return signManifestWith(m, privateKeyToAccount(privateKey));
}

/**
 * Recover the signer and check it against the declared creator.
 *
 * Offchain verification only. The chain does not recover signatures: msg.sender
 * is already authenticated there, and the manifest carries its own signature so
 * anyone holding a copy from the event log can check it independently.
 */
export async function verifyManifest(m: GrainManifest): Promise<boolean> {
  if (!m.signature) return false;
  const hash = manifestHash(m);
  // Two forms of the same commitment. Passkey and key-in-hand signers sign the
  // 32-byte hash itself; wallets that only sign text (MetaMask's agent wallet)
  // sign the hash written as 0x-prefixed hex. Both bind exactly this hash.
  for (const message of [{ raw: hash }, hash] as const) {
    try {
      const recovered = await recoverMessageAddress({ message, signature: m.signature });
      if (recovered.toLowerCase() === m.creator.toLowerCase()) return true;
    } catch { /* malformed signature: try the other form, then fail */ }
  }
  return false;
}

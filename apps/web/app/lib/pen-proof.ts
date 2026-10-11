import { concat, keccak256, verifyMessage, type Address, type Hex, type PublicClient } from 'viem';
import { CONTRACTS, creatorAbi } from './chain';

/**
 * PROVABLE PEN NAMES.
 *
 * A pen name is a separate account from the same passkey, unlinkable on chain
 * to the creator's identity. Sometimes the creator needs to prove "that pen
 * name is me" -- to a client, an editor, a court -- without telling everyone.
 *
 * The passkey's PRF gives a third key, beside the signing keys and the notes
 * key: the pen-link key (HKDF "grain.v1.pen-link"). It never signs a
 * transaction. It makes, per pen name,
 *
 *   tag        = HMAC-SHA256(pen-link key, pen address)
 *   commitment = keccak256(tag ‖ identity address)
 *
 * The commitment sits in the pen account's on-chain profile. Without the tag
 * it is noise: nobody can test it against any identity. To prove one pen name,
 * the creator reveals that pen name's tag, signed by their identity. Every
 * other pen name stays unlinkable, because each has its own tag.
 */

export const PEN_LINK_PREFIX = 'grain:penlink:';

export const penCommitment = (tag: Hex, identity: Address): Hex =>
  keccak256(concat([tag, identity.toLowerCase() as Hex]));

export const penProfileURI = (tag: Hex, identity: Address) => `${PEN_LINK_PREFIX}${penCommitment(tag, identity)}`;

/** What the identity signs: who claims which pen name, and when. */
export function proofMessage(penHandle: string, pen: Address, identity: Address, issuedAt: number): string {
  return [
    'Grain pen-name proof',
    `I am the creator behind @${penHandle} (${pen.toLowerCase()}).`,
    `My identity: ${identity.toLowerCase()}`,
    `Issued: ${new Date(issuedAt * 1000).toISOString()}`,
  ].join('\n');
}

export interface PenProof { pen: string; identity: Address; tag: Hex; issuedAt: number; sig: Hex }

export function proofLink(origin: string, p: PenProof): string {
  const q = new URLSearchParams({ pen: p.pen, id: p.identity, tag: p.tag, t: String(p.issuedAt), sig: p.sig });
  return `${origin}/proof?${q}`;
}

export function parseProof(params: URLSearchParams): PenProof | null {
  const pen = params.get('pen'), id = params.get('id'), tag = params.get('tag'), t = params.get('t'), sig = params.get('sig');
  if (!pen || !/^[a-z0-9-]{1,32}$/.test(pen) || !id || !/^0x[0-9a-fA-F]{40}$/.test(id)) return null;
  if (!tag || !/^0x[0-9a-f]{64}$/i.test(tag) || !t || !/^\d+$/.test(t) || !sig || !/^0x[0-9a-f]+$/i.test(sig)) return null;
  return { pen, identity: id as Address, tag: tag as Hex, issuedAt: Number(t), sig: sig as Hex };
}

export type ProofCheck =
  | { ok: true; pen: Address; penHandle: string; identity: Address; identityHandle: string | null; issuedAt: number }
  | { ok: false; reason: string };

/** Everything checked against Monad and the signature; nothing taken from the link on trust. */
export async function checkProof(client: PublicClient, p: PenProof): Promise<ProofCheck> {
  const pen = await client.readContract({
    address: CONTRACTS.CreatorRegistry, abi: creatorAbi, functionName: 'handleOwner',
    args: [keccak256(new TextEncoder().encode(p.pen))],
  }) as Address;
  if (!pen || /^0x0+$/.test(pen)) return { ok: false, reason: `No one holds the name @${p.pen} on Grain.` };
  const [penProfile, idProfile] = await Promise.all([
    client.readContract({ address: CONTRACTS.CreatorRegistry, abi: creatorAbi, functionName: 'creators', args: [pen] }),
    client.readContract({ address: CONTRACTS.CreatorRegistry, abi: creatorAbi, functionName: 'creators', args: [p.identity] }),
  ]) as [{ profileURI: string }, { handle: string }];
  if (!penProfile.profileURI.startsWith(PEN_LINK_PREFIX)) return { ok: false, reason: `@${p.pen} has not made itself provable.` };
  if (penProfile.profileURI !== penProfileURI(p.tag, p.identity)) {
    return { ok: false, reason: `This proof doesn't match the commitment @${p.pen} recorded on Monad.` };
  }
  const signed = await verifyMessage({ address: p.identity, message: proofMessage(p.pen, pen, p.identity, p.issuedAt), signature: p.sig });
  if (!signed) return { ok: false, reason: 'The identity did not sign this proof.' };
  return { ok: true, pen, penHandle: p.pen, identity: p.identity, identityHandle: idProfile.handle || null, issuedAt: p.issuedAt };
}

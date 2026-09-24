'use client';

import {
  createPasskeyWithPrfOutput, getPasskeyPrfOutput, isMeraError,
  type PasskeyCredentialTransport,
} from '@category-labs/mera';
import { entropyToMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { HDKey } from '@scure/bip32';
import { sha256 } from '@noble/hashes/sha2.js';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { bytesToHex, type Hex } from 'viem';

/**
 * Passkey identity (SPEC.md §9).
 *
 * One passkey, three key namespaces, distinguished by PRF salt. The passkey
 * never leaves the authenticator and nothing derived from it is persisted --
 * only the credential id and transports go to localStorage, and that metadata
 * holds no key material.
 *
 * THREE NAMESPACES (SPEC.md §9.3):
 *   grain.identity.v1  the creator signing key, HD index 0. Signs every manifest.
 *   grain.channel.v1   per-channel publishing keys at HD index n. Registrations
 *                      are unlinkable across channels yet all recoverable from
 *                      the one passkey.
 *   grain.vault.v1     HKDF -> AES-256-GCM, encrypting private manifest fields.
 *
 * Distinct salts matter: a vault key and a signing key derived from the same
 * PRF output would be the same secret wearing two hats.
 */

export const NAMESPACES = {
  identity: 'grain.identity.v1',
  channel: 'grain.channel.v1',
  vault: 'grain.vault.v1',
} as const;

export type Namespace = keyof typeof NAMESPACES;

const STORAGE_KEY = 'grain.credential.v1';
const RP_NAME = 'Grain';

/** Salts are sha256 of the namespace label, so they are stable and 32 bytes. */
function saltFor(ns: Namespace): Uint8Array {
  return sha256(new TextEncoder().encode(NAMESPACES[ns]));
}

interface StoredCredential {
  credentialId: string;
  transports?: readonly PasskeyCredentialTransport[];
}

export function storedCredential(): StoredCredential | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredCredential) : null;
  } catch {
    return null;
  }
}

function remember(c: StoredCredential) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    /* private browsing; the passkey still works, we just re-prompt to pick it */
  }
}

/**
 * The error that will actually happen, in plain language.
 *
 * On desktop Chrome only passkeys saved to Google Password Manager return PRF.
 * When Chrome saves to the local profile instead, the passkey is created but
 * PRF is unavailable. The docs call this the most common setup failure.
 * The code goes to the console; the person sees a sentence they can act on.
 */
export class PasskeyUnavailable extends Error {
  constructor(public readonly code: string) {
    super(
      code === 'PRF_UNAVAILABLE'
        ? "Your browser saved this passkey somewhere Grain can't use. Save it to Google Password Manager instead, or use Safari, iOS, or 1Password."
        : "Grain couldn't use your passkey just now. Try again, or use a different browser.",
    );
    this.name = 'PasskeyUnavailable';
  }
}

async function prfOutputFor(ns: Namespace, displayName?: string): Promise<Uint8Array> {
  const prfSalt = saltFor(ns);
  const existing = storedCredential();

  try {
    // The app knows whether this is a first visit; it never asks the person to
    // choose between "create account" and "sign in" (UX_SPEC /register).
    if (existing) {
      const { prfOutput } = await getPasskeyPrfOutput({
        rpId: location.hostname,
        credential: {
          credentialId: existing.credentialId,
          transports: existing.transports as PasskeyCredentialTransport[] | undefined,
        },
        prfSalt,
      });
      return prfOutput;
    }

    const created = await createPasskeyWithPrfOutput({
      rp: { id: location.hostname, name: RP_NAME },
      user: { name: displayName ?? 'Grain creator', displayName: displayName ?? 'Grain creator' },
      prfSalt,
    });
    remember({ credentialId: created.credentialId, transports: created.transports });
    return created.prfOutput;
  } catch (e) {
    if (isMeraError(e)) {
      console.error('mera error', e.code, e);
      throw new PasskeyUnavailable(e.code);
    }
    throw e;
  }
}

/**
 * PRF output -> BIP-39 -> HD key.
 *
 * Deriving this way keeps the account portable: the mnemonic imports into
 * MetaMask or Rabby and produces the same address, so a creator is never
 * locked into Grain to control their own identity.
 */
function accountFrom(prfOutput: Uint8Array, index: number): PrivateKeyAccount {
  const mnemonic = entropyToMnemonic(prfOutput, wordlist);
  const seed = mnemonicToSeedSync(mnemonic);
  const key = HDKey.fromMasterSeed(seed).derive(`m/44'/60'/0'/0/${index}`);
  if (!key.privateKey) throw new Error('derivation produced no private key');
  return privateKeyToAccount(bytesToHex(key.privateKey) as Hex);
}

export interface Session {
  account: PrivateKeyAccount;
  /** Zeroes the derived material. Call when the signing session is over. */
  end: () => void;
}

/** The creator signing key. HD index 0 of the identity namespace. */
export async function identitySession(displayName?: string): Promise<Session> {
  const prf = await prfOutputFor('identity', displayName);
  const account = accountFrom(prf, 0);
  return { account, end: () => prf.fill(0) };
}

/**
 * A per-channel publishing key: one per outlet, so registrations made under
 * different channels are unlinkable on chain while all remaining recoverable
 * from the single passkey.
 */
export async function channelSession(index: number): Promise<Session> {
  const prf = await prfOutputFor('channel');
  const account = accountFrom(prf, index);
  return { account, end: () => prf.fill(0) };
}

/**
 * AES-256-GCM key for private manifest fields (capture location, device,
 * client name). C2PA itself warns that identity assertions carry privacy
 * implications; this is Grain's answer -- the plaintext never leaves the
 * browser and the key is re-derivable from the passkey on any device.
 */
export async function vaultKey(): Promise<CryptoKey> {
  const prf = await prfOutputFor('vault');
  try {
    const base = await crypto.subtle.importKey('raw', prf as BufferSource, 'HKDF', false, ['deriveKey']);
    return await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: saltFor('vault') as BufferSource,
        info: new TextEncoder().encode('grain.vault.aesgcm.v1') },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  } finally {
    prf.fill(0);
  }
}

export async function encryptPrivateFields(fields: Record<string, unknown>): Promise<Hex> {
  const key = await vaultKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(fields));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv); out.set(ct, iv.length);
  return bytesToHex(out);
}

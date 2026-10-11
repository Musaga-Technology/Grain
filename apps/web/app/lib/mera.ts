'use client';

import {
  createPasskeyWithPrfOutput, createSecp256k1SigningSession, getPasskeyPrfOutput, isMeraError,
  type PasskeyCredentialTransport,
} from '@category-labs/mera';
import { toViemAccount } from '@category-labs/mera/viem';
import { entropyToMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { HDKey } from '@scure/bip32';
import { sha256 } from '@noble/hashes/sha2.js';
import type { LocalAccount } from 'viem/accounts';
import { bytesToHex, hexToBytes, type Hex } from 'viem';

/**
 * Passkey accounts, entirely on Mera: no seed phrase, no extension, no custody
 * backend.
 *
 * ONE PASSKEY, ONE PROMPT, MANY KEYS. A single passkey assertion returns one
 * PRF output; every key Grain uses is derived from it in the browser, then the
 * output is wiped. Nothing derived is ever stored -- only the credential id
 * and transports go to localStorage, and they hold no key material.
 *
 *   identity    m/44'/60'/0'/0/0   the creator's account. Signs every manifest
 *                                  and transaction.
 *   pen names   m/44'/60'/1'/0/n   one account per pen name. Unlinkable on
 *                                  chain to the identity or to each other, all
 *                                  recoverable from the same passkey on any
 *                                  device.
 *   notes key   HKDF(prf, "grain.v1.private-notes") -> AES-256-GCM. Encrypts
 *                                  a record's private note, which only this
 *                                  passkey can read.
 *   pen-link key HKDF(prf, "grain.v1.pen-link") -> HMAC-SHA256. Never signs
 *                                  anything: it makes each pen name's secret
 *                                  tag, so the creator can later prove one pen
 *                                  name is theirs and leave the rest
 *                                  unlinkable (see lib/pen-proof).
 *
 * Signing keys run as Mera secp256k1 signing sessions, adapted to viem with
 * Mera's toViemAccount, so a key lives exactly as long as its session and is
 * zeroed when the session ends. The HD derivation goes through BIP-39 so the
 * identity stays portable: the same words import into MetaMask or Rabby and
 * produce the same address, and nobody is locked into Grain to control their
 * own account.
 */

/** The PRF salt. Unchanged from the first release, so existing accounts keep their addresses. */
const PRF_LABEL = 'grain.identity.v1';
const NOTES_INFO = 'grain.v1.private-notes';
const PEN_LINK_INFO = 'grain.v1.pen-link';

const STORAGE_KEY = 'grain.credential.v1';
const RP_NAME = 'Grain';

/** sha256 of a fixed label: stable, and exactly the 32 bytes Mera requires. */
const prfSalt = () => sha256(new TextEncoder().encode(PRF_LABEL));

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

async function prfOutput(displayName?: string): Promise<Uint8Array> {
  const salt = prfSalt();
  const existing = storedCredential();

  try {
    // The app knows whether this is a first visit; it never asks the person to
    // choose between "create account" and "sign in".
    if (existing) {
      const { prfOutput } = await getPasskeyPrfOutput({
        rpId: location.hostname,
        credential: {
          credentialId: existing.credentialId,
          transports: existing.transports as PasskeyCredentialTransport[] | undefined,
        },
        prfSalt: salt,
      });
      return prfOutput;
    }

    const created = await createPasskeyWithPrfOutput({
      rp: { id: location.hostname, name: RP_NAME },
      user: { name: displayName ?? 'Grain creator', displayName: displayName ?? 'Grain creator' },
      prfSalt: salt,
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

export interface Session {
  /** A viem account backed by a Mera signing session. */
  account: LocalAccount;
  /** Ends the Mera signing session, zeroing its key. */
  end: () => void;
}

/** Everything one passkey prompt unlocks. */
export interface Keyring {
  /** The creator's main account. */
  identity: Session;
  /** Pen name n (1-based). Each is its own unlinkable account. */
  penName: (n: number) => Session;
  /** Encrypts a private note so only this passkey can read it. */
  sealNote: (note: string) => Promise<Hex>;
  /** Decrypts a note sealed by this passkey; null if it isn't ours or is damaged. */
  openNote: (sealed: Hex) => Promise<string | null>;
  /** A pen name's secret tag, HMAC(pen-link key, pen address): revealing it proves that one pen name. */
  penLinkTag: (penAddress: string) => Promise<Hex>;
  /** Ends every session and wipes the derived material. */
  end: () => void;
}

const IDENTITY_PATH = "m/44'/60'/0'/0/0";
const penNamePath = (n: number) => `m/44'/60'/1'/0/${n}`;

/** Builds the keyring from 32 bytes of entropy, then wipes the entropy. */
export async function keyringFrom(entropy: Uint8Array): Promise<Keyring> {
  const root = HDKey.fromMasterSeed(mnemonicToSeedSync(entropyToMnemonic(entropy, wordlist)));
  const sessions: { end: () => void }[] = [];

  const session = (path: string): Session => {
    const key = root.derive(path).privateKey;
    if (!key) throw new Error('derivation produced no private key');
    const mera = createSecp256k1SigningSession({ privateKey: key });
    key.fill(0);
    sessions.push(mera);
    return { account: toViemAccount(mera), end: () => mera.end() };
  };

  const base = await crypto.subtle.importKey('raw', entropy as BufferSource, 'HKDF', false, ['deriveKey']);
  const notesKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32) as BufferSource, info: new TextEncoder().encode(NOTES_INFO) },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
  const penLinkKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32) as BufferSource, info: new TextEncoder().encode(PEN_LINK_INFO) },
    base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign'],
  );
  entropy.fill(0);

  const identity = session(IDENTITY_PATH);
  const pens = new Map<number, Session>();
  return {
    identity,
    penName: (n) => {
      if (!Number.isInteger(n) || n < 1) throw new Error('pen names are numbered from 1');
      if (!pens.has(n)) pens.set(n, session(penNamePath(n)));
      return pens.get(n)!;
    },
    sealNote: async (note) => {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, notesKey, new TextEncoder().encode(note)));
      const out = new Uint8Array(12 + ct.length);
      out.set(iv); out.set(ct, 12);
      return bytesToHex(out);
    },
    openNote: async (sealed) => {
      try {
        const bytes = hexToBytes(sealed);
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, notesKey, bytes.slice(12));
        return new TextDecoder().decode(pt);
      } catch {
        return null;
      }
    },
    penLinkTag: async (penAddress) => bytesToHex(new Uint8Array(await crypto.subtle.sign(
      'HMAC', penLinkKey, new TextEncoder().encode(penAddress.toLowerCase()),
    ))),
    end: () => { for (const s of sessions) s.end(); root.wipePrivateData(); },
  };
}

/** One passkey prompt -> every key. Creates the passkey on a first visit. */
export async function unlock(displayName?: string): Promise<Keyring> {
  return keyringFrom(await prfOutput(displayName));
}

/** The creator signing key alone, for callers that need nothing else. */
export async function identitySession(displayName?: string): Promise<Session> {
  const ring = await unlock(displayName);
  return { account: ring.identity.account, end: ring.end };
}

/**
 * FALLBACK FOR DEVICES THAT CANNOT DO PRF.
 *
 * Without PRF a passkey yields no secret, so there is nothing to derive an
 * account from. The alternative is a key generated here and kept in this
 * browser. It goes through the same BIP-39 and HD path as the passkey route, so
 * the account is an ordinary EOA either way and the registry cannot tell them
 * apart.
 *
 * What it gives up, and the UI must say so before anyone chooses it:
 *  - the identity lives in this browser only; another device cannot recover it
 *  - clearing site data destroys it, and records registered with it can no
 *    longer be superseded or revoked
 *  - the key sits in localStorage, readable by any script running on this
 *    origin, where a passkey's secret never leaves the authenticator
 *
 * On testnet, where nothing has value, that is a far better outcome than
 * registration dead-ending for every visitor whose browser lacks PRF. On
 * mainnet it would need rethinking.
 */
const DEVICE_KEY = 'grain.devicekey.v1';

export function hasDeviceKey(): boolean {
  try { return localStorage.getItem(DEVICE_KEY) !== null; } catch { return false; }
}

export async function deviceKeyring(): Promise<Keyring> {
  let hex: string | null = null;
  try { hex = localStorage.getItem(DEVICE_KEY); } catch { /* private browsing */ }

  let entropy: Uint8Array;
  if (hex && /^[0-9a-f]{64}$/.test(hex)) {
    entropy = new Uint8Array(hex.match(/../g)!.map((b) => parseInt(b, 16)));
  } else {
    entropy = crypto.getRandomValues(new Uint8Array(32));
    try {
      localStorage.setItem(DEVICE_KEY, [...entropy].map((b) => b.toString(16).padStart(2, '0')).join(''));
    } catch {
      throw new Error('This browser is blocking storage, so Grain cannot keep a key here.');
    }
  }

  return keyringFrom(entropy);
}

export async function deviceSession(): Promise<Session> {
  const ring = await deviceKeyring();
  return { account: ring.identity.account, end: ring.end };
}

'use client';

import type { SourceCredentialAssertion } from '@grain/core';
import { bytesToHex, type Hex } from 'viem';

/**
 * Reads the C2PA credential an image already carries -- from OpenAI, Adobe
 * Firefly, a camera -- in the browser, with Adobe's c2pa-web (WebAssembly).
 * The image never leaves the device, the same as for watermarking.
 *
 * Validation is checked against the C2PA trust list where the browser can
 * fetch it ("Trusted"), and is otherwise cryptographic only ("Valid"): the
 * signature and the hard binding hold, but the signer isn't checked against a
 * list of trusted issuers. The state recorded says which.
 */

const WASM = '/c2pa/c2pa_bg.wasm';
// The official C2PA trust list plus the interim Content Credentials list,
// served from this site (contentcredentials.org doesn't allow cross-site fetches).
const TRUST_ANCHORS = '/c2pa-trust/anchors.pem';
// The certificate purposes (EKUs) a C2PA signer may use: the reference SDK's
// list (c2pa-rs store.cfg), which c2patool applies too. Without it the
// browser library rejects valid signers such as OpenAI's.
const TRUST_CONFIG = '/c2pa-trust/store.cfg';

type C2pa = Awaited<ReturnType<typeof import('@contentauth/c2pa-web').createC2pa>>;
let instance: Promise<C2pa> | undefined;
const c2pa = () => (instance ??= import('@contentauth/c2pa-web').then(({ createC2pa }) => createC2pa({ wasmSrc: WASM })));

interface ManifestJson {
  label?: string | null;
  claim_generator?: string | null;
  claim_generator_info?: { name?: string; version?: string }[] | null;
  signature_info?: { issuer?: string | null; common_name?: string | null; time?: string | null } | null;
  assertions?: { label?: string; data?: { actions?: { action?: string; digitalSourceType?: string; softwareAgent?: { name?: string } | string }[] } }[];
}
interface StoreJson { active_manifest?: string | null; manifests?: Record<string, ManifestJson>; validation_state?: 'Invalid' | 'Valid' | 'Trusted' | null }

async function readStore(blob: Blob, verifyTrust: boolean): Promise<StoreJson | null> {
  const { Reader, Context } = await import('@contentauth/c2pa-web');
  const url = (p: string) => new URL(p, location.origin).href;
  const context = new Context(verifyTrust
    ? { verify: { verifyTrust: true }, trust: { trustAnchors: url(TRUST_ANCHORS), trustConfig: url(TRUST_CONFIG) } }
    : { verify: { verifyTrust: false }, trust: { trustConfig: url(TRUST_CONFIG) } });
  const reader = await Reader.fromBlob(await c2pa(), blob.type || 'image/png', blob, context);
  if (!reader) return null;
  try { return (await reader.manifestStore()) as StoreJson; } finally { await reader.free(); }
}

/** The image's C2PA credential, summarised for Grain's manifest; null when it carries none. */
export async function readSourceCredential(file: Blob): Promise<SourceCredentialAssertion | null> {
  // Trusted if the signer chains to the C2PA trust lists; otherwise the
  // cryptographic result alone, so a trust-list problem can never make a valid
  // credential look invalid.
  let store: StoreJson | null = await readStore(file, true).catch(() => null);
  if (store?.validation_state !== 'Trusted') {
    const plain = await readStore(file, false).catch(() => null);
    if (plain) store = plain;
  }
  const active = store?.active_manifest ? store.manifests?.[store.active_manifest] : undefined;
  if (!store || !active) return null;

  const actions = active.assertions?.find((a) => a.label?.startsWith('c2pa.actions'))?.data?.actions ?? [];
  const created = actions.find((a) => a.digitalSourceType) ?? actions[0];
  // The tool: the creating action's software agent ("ChatGPT"), else the claim generator.
  const agent = created?.softwareAgent;
  const tool = (typeof agent === 'string' ? agent : agent?.name) ?? active.claim_generator_info?.[0]?.name ?? active.claim_generator?.split(/[ /]/)[0] ?? undefined;
  const sig = active.signature_info ?? {};
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  return {
    standard: 'c2pa',
    manifest: store.active_manifest!,
    signer: sig.common_name ?? sig.issuer ?? undefined,
    issuer: sig.issuer ?? undefined,
    tool: tool || undefined,
    signedAt: sig.time ?? undefined,
    validation: store.validation_state === 'Trusted' ? 'Trusted' : store.validation_state === 'Invalid' ? 'Invalid' : 'Valid',
    digitalSourceType: created?.digitalSourceType,
    assetSha256: bytesToHex(digest) as Hex,
  };
}

export { credentialName } from './credential-name';

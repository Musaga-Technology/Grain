'use client';

/**
 * Pre-flight capability check.
 *
 * Mera creates the passkey first and evaluates PRF second, and its docs are
 * explicit that a failure after the creation ceremony leaves the passkey on the
 * authenticator without returning its metadata. So every failed attempt strands
 * an orphan credential the app can neither use nor clean up, and a person who
 * retries three times now has three of them.
 *
 * Checking first costs one cheap call and avoids all of that.
 */

export type PasskeySupport =
  | { ok: true }
  | { ok: false; reason: 'no-webauthn' | 'insecure-context'; message: string };

/**
 * Whether this device has its own biometric or device unlock. Informational
 * only: it decides the button label, never whether registration may proceed.
 */
export async function hasBuiltInAuthenticator(): Promise<boolean> {
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function checkPasskeySupport(): Promise<PasskeySupport> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) {
    return {
      ok: false,
      reason: 'no-webauthn',
      message: "This browser can't create the kind of secure key Grain uses. Try Safari, Chrome, or Edge.",
    };
  }

  // PRF needs a secure context. localhost counts; plain http on a LAN address
  // does not, which is a real trap when testing from a phone.
  if (!window.isSecureContext) {
    return {
      ok: false,
      reason: 'insecure-context',
      message: 'Grain needs a secure connection to create your key. Open this page over https.',
    };
  }

  // NOT a gate on a built-in biometric. A machine without Touch ID or Face ID
  // can still use a phone (scan a QR code), a password manager like 1Password,
  // or a hardware security key. Blocking on the platform authenticator would
  // turn away exactly the people those alternatives exist for -- including the
  // machine this was first tested on.
  return { ok: true };
}

/**
 * What to actually do about PRF_UNAVAILABLE, by browser.
 *
 * The generic advice ("use a different browser") is useless to someone who does
 * not know which part of their setup is at fault. On desktop Chrome the passkey
 * itself is fine -- it is *where Chrome saved it* that breaks PRF, and that is
 * fixable without changing browser.
 */
export function prfAdvice(): { headline: string; steps: string[] } {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const isChrome = /Chrome|Chromium|Edg/.test(ua) && !/OPR/.test(ua);
  const isSafari = /Safari/.test(ua) && !/Chrome|Chromium/.test(ua);
  const isMac = /Mac/.test(ua);

  if (isChrome) {
    return {
      headline: 'Chrome saved your key to the wrong place',
      steps: [
        'Chrome can only use keys it saved to Google Password Manager, not ones saved to this computer.',
        'Open chrome://settings/passkeys and delete any key for this site — those ones cannot be used.',
        'Try again, and when Chrome asks where to save it, choose Google Password Manager.',
        isMac
          ? 'Or simply open this page in Safari, which uses iCloud Keychain and always works.'
          : 'Or install 1Password, which works in every browser.',
      ],
    };
  }

  if (isSafari) {
    return {
      headline: 'Safari could not use iCloud Keychain',
      steps: [
        'Check that iCloud Keychain is switched on in System Settings, under your Apple Account then iCloud.',
        'If you are in a Private window, try a normal one — passkeys are restricted in private browsing.',
      ],
    };
  }

  return {
    headline: "This browser can't provide the key Grain needs",
    steps: [
      'Safari on a Mac or iPhone works out of the box.',
      'On other systems, 1Password provides the same capability in any browser.',
    ],
  };
}

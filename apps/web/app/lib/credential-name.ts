/** The organisation behind a C2PA credential, short enough for a badge: "OpenAI" from "OpenAI OpCo, LLC". */
export function credentialName(s: { signer?: string; issuer?: string; tool?: string }): string {
  let name = s.issuer || s.signer || s.tool || 'an unknown signer';
  for (let i = 0; i < 3; i++) name = name.replace(/,?\s*(Inc|LLC|Ltd|Limited|Corp|Corporation|OpCo|GmbH|S\.A\.)\.?$/i, '').trim();
  return name;
}

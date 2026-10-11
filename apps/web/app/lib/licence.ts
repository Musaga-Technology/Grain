/** The terms a Grain licence grants (see /licence). Fixed for v1. */
export const LICENCE_VERSION = 'Grain Licence v1';
export const LICENCE_PATH = '/licence';

/** The terms themselves, shown on /licence and returned to AI assistants by the MCP server. */
export const LICENCE_TERMS: [string, string][] = [
  ['Use it', 'Worldwide, in any medium, for personal or commercial work, for as long as you like.'],
  ['Not exclusive', 'The creator can license the same image to others, and keeps their copyright.'],
  ['Credit them', 'Credit the creator where practical, for example "Image: @handle via Grain".'],
  ["Don't resell the file", "Don't sell, give away or redistribute the image itself as a standalone file, or as stock."],
  ["Don't claim it", "Don't claim you made it, and don't remove or forge its Grain credentials."],
  ['Your proof', 'The licence is the on-chain record of your payment. Anyone can check it, and it never expires.'],
];

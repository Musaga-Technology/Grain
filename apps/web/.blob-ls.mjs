import { readFileSync } from 'node:fs';
import { list } from '@vercel/blob';
const token = readFileSync('.env.local', 'utf8').match(/^BLOB_READ_WRITE_TOKEN="?([^"\n]+)"?/m)[1];
const { blobs } = await list({ prefix: 'activity/', token });
console.log(blobs.map((b) => b.pathname.split('/').pop()));

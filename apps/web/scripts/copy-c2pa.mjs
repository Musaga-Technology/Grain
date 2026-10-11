// Serve the C2PA reader's WebAssembly from this site, like the TrustMark models:
// a third-party CDN reset large downloads mid-transfer in testing.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const pkg = dirname(createRequire(import.meta.url).resolve('@contentauth/c2pa-web/package.json'));
mkdirSync('public/c2pa', { recursive: true });
copyFileSync(join(pkg, 'dist/resources/c2pa_bg.wasm'), 'public/c2pa/c2pa_bg.wasm');
console.log('copied c2pa_bg.wasm to public/c2pa');

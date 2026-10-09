// Bundles each command with grain-core and the site's TrustMark port inlined,
// so the published package depends on nothing in this monorepo. The host CLI,
// the ONNX runtime and viem stay external: they are real npm dependencies.
import { build } from 'esbuild';
import { readdirSync, readFileSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
const commands = readdirSync('src/commands/grain').filter((f) => f.endsWith('.ts'));

// mm only runs, and only grants capabilities to, commands declared in
// package.json#mm. A command that is built but not declared fails at run time
// with a capability error, so refuse to build until the two agree.
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const declared = pkg.mm.commands.map((c) => c.id).sort();
const built = commands.map((f) => `grain:${f.replace(/\.ts$/, '')}`).sort();
if (JSON.stringify(declared) !== JSON.stringify(built)) {
  throw new Error(`package.json#mm.commands ${JSON.stringify(declared)} must match the built commands ${JSON.stringify(built)}`);
}
await build({
  entryPoints: Object.fromEntries(commands.map((f) => [`commands/grain/${f.replace(/\.ts$/, '')}`, `src/commands/grain/${f}`])),
  outdir: 'dist',
  bundle: true,
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  external: ['@metamask/agent-wallet', '@metamask/agent-wallet/*', 'onnxruntime-web', 'viem'],
  // The site imports the WASM-only build, which the package closes to Node
  // ("node": null). Its main entry has a Node build with the same API.
  alias: { 'onnxruntime-web/wasm': 'onnxruntime-web' },
  logLevel: 'warning',
});
console.log(`built ${commands.length} commands`);

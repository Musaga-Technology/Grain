// Bundles each command with grain-core and the site's TrustMark port inlined,
// so the published package depends on nothing in this monorepo. The host CLI,
// the ONNX runtime and viem stay external: they are real npm dependencies.
import { build } from 'esbuild';
import { readdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
const commands = readdirSync('src/commands/grain').filter((f) => f.endsWith('.ts'));
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

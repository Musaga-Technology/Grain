// For installing this plugin from a local folder (mm plugins install file:...).
//
// A plugin must use the RUNNING mm CLI's own @metamask/agent-wallet, never a
// copy: a copy boots a second CLI bundle, which crashes on browser-only globals
// ("window.addEventListener is not a function") and breaks mm's shared plugin
// state. mm links its own copy for plugins installed from npm; a local folder
// resolves from its own node_modules instead, so this replaces the build-time
// copy there with a link to the installed CLI, the same thing mm does.
import { execSync } from 'node:child_process';
import { lstatSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

// The globally installed CLI, which is the one `mm` runs. Not `command -v mm`:
// under `npm run`, this folder's own node_modules/.bin comes first on PATH.
const root = join(execSync('npm root -g', { encoding: 'utf8' }).trim(), '@metamask', 'agent-wallet');
try { realpathSync(join(root, 'package.json')); } catch {
  throw new Error(`mm is not installed globally (looked in ${root}). Run: npm install -g @metamask/agent-wallet`);
}

const target = join('node_modules', '@metamask', 'agent-wallet');
mkdirSync(dirname(target), { recursive: true });
try { lstatSync(target); rmSync(target, { recursive: true, force: true }); } catch { /* not there yet */ }
symlinkSync(root, target, 'dir');
console.log(`linked ${target} -> ${root}`);

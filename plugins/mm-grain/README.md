# mm-plugin-grain

**Grain for the [MetaMask Agent Wallet](https://docs.metamask.io/agent-wallet/).** Before an agent reposts, publishes or pays for an image, it can ask who made it, from the image itself, even after screenshots, crops and re-encoding. Then it can license the image at the creator's price, or pay them directly.

```
mm grain verify <image>          who made this image?
mm grain license <image|record>  license it at the creator's price, on chain
mm grain pay <image|record> <n>  pay them any amount, through your MetaMask wallet
mm grain record <id>             look up a record
mm grain creator <handle>        everything a creator has registered
```

## Why an agent needs this

Agents increasingly pick images to post, buy or build on, and they have no way to tell where an image came from. Content credentials (C2PA) are stripped by the first screenshot. [Grain](https://grain-on-monad.vercel.app) is an open onchain registry that finds them again: an invisible TrustMark watermark and a perceptual fingerprint, cross-checked so that a watermark copied onto someone else's picture is reported as **forged** rather than believed.

This plugin gives an agent the same answer the website gives, as JSON, and closes the loop with MetaMask: **find the human who made it, then license it from them.**

## Commands

### `mm grain verify <image>`

A local PNG/JPEG path or an http(s) URL. No sign-in or wallet needed.

```
$ mm grain verify https://grain-on-monad.vercel.app/samples/forged.jpg --json
{
  "ok": true,
  "data": {
    "state": "TAMPERED",
    "summary": "Forged credential: the image carries @grain-studio's watermark, but the picture does not match what they registered. Do not attribute it to them.",
    "watermark": "found",
    "candidatesFrom": "indexer",
    "onChainDistance": 32,
    ...
  }
}
```

| `state` | Meaning | What an agent should do |
|---|---|---|
| `RESOLVED` | Made by the creator in `record` | attribute it, or pay them |
| `UNCERTAIN` | Heavily edited; probably that creator | attribute with care |
| `TAMPERED` | A watermark copied onto a different picture | **do not attribute it** |
| `NOT_FOUND` | Not registered, or edited past recognition | treat as unknown |

`onChainDistance` comes from `FingerprintIndex.verify()` on the contract itself, not from the indexer, so the agent never has to trust Grain's servers for the answer.

The first run downloads the 45 MB watermark decoder once into `~/.cache/grain/models`. `--fast` skips it and matches by fingerprint alone, which also means it cannot detect forged watermarks.

### `mm grain license <image|record>`

Licenses the image through Grain's `LicenseRegistry` on Monad testnet, at the price the creator set when they registered. The contract forwards the full amount to the creator (there is no protocol fee) and records the licence on chain, where Grain's Envio indexer picks it up. Needs `mm login` and `wallet-submit`.

```
$ mm grain license https://grain-on-monad.vercel.app/samples/reposted.jpg --max-price 0.05 --dry-run
Licensing record 511 costs 0.01 MON, paid in full to @grain-studio. Nothing was sent.
```

- `--max-price` refuses if the creator asks more. Use it for any unattended agent.
- Same strictness as `pay`: forged, uncertain and withdrawn matches are refused, and so is a creator with no price set (the error suggests `pay` instead).
- `mm grain record <id>` shows the price and how many licences have been granted.

### `mm grain pay <image|record> <amount>`

Finds the creator, then sends them the amount through MetaMask's policy-gated wallet executor. Needs `mm login` and the `wallet-submit` capability, which you approve at install.

```
$ mm grain pay ./downloaded.jpg 0.5 --dry-run
Would send 0.5 on chain 10143 to @grain-studio (0x5c71…d7C8), the creator of record 511. Nothing was sent.
```

- **Strict on purpose.** It pays only on a clean `RESOLVED` match or an explicit record number. A forged or uncertain match is refused with the reason, and so is a record its creator has withdrawn.
- **Any chain your wallet supports.** A Grain creator's account is an ordinary EOA derived from their passkey, so the same address receives on every EVM chain. Payments default to **Monad testnet (10143)**, where the registry lives; `--chain-id 143` pays on Monad mainnet, or any other chain your wallet supports.
- `--dry-run` shows the exact transaction without sending it.

### `mm grain record <id>` and `mm grain creator <handle>`

Lookups. `creator` lists a creator's records through Grain's Envio indexer, because the contracts alone cannot list them.

## Install

```bash
mm config set experimentalPlugins true
mm plugins install mm-plugin-grain
```

From this repository:

```bash
cd plugins/mm-grain && npm install && npm run build
npm run link-host        # use the installed mm's own CLI package, not a copy (see link-host.mjs)
mm config set experimentalAllowUnverifiedInstalls true
mm plugins install "file:$PWD" --accept-permissions
```

Skip `link-host` and the plugin loads a second copy of the CLI, which crashes with `window.addEventListener is not a function`. Installs from npm don't need it; mm links its own copy for those.

## How it works

The plugin bundles Grain's own resolver (`packages/grain-core`) and the website's browser TrustMark port, run on ONNX Runtime's WASM backend in Node. The verdict logic is the same code the website runs, so the CLI and the site cannot disagree about an image. Candidate lookups go to the Envio indexer and fall back to Monad's RPC.

| Variable | Default |
|---|---|
| `GRAIN_INDEXER_URL` | Grain's Envio Cloud endpoint |
| `GRAIN_RPC_URL` | `https://testnet-rpc.monad.xyz` |
| `GRAIN_SITE` | `https://grain-on-monad.vercel.app` (model downloads, record links) |

MIT

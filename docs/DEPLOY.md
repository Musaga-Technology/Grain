# Deploying

Two pieces, two hosts, for one reason: **the TrustMark models must stay
resident.** The decoder is 45 MB and the encoder 17 MB, and a serverless
function reloads them on every invocation — which is the two seconds
`packages/trustmarkd` exists to remove (docs/RESOLVER.md). So the resolver
needs a container, and everything else is happy on Vercel.

| Piece | Host | Why |
|---|---|---|
| Next.js app | Vercel | Static and edge-friendly; no heavy runtime |
| Resolver + daemon | Any container host (Fly, Railway, Render) | 95 MB of models held in memory |
| Indexer | Envio Cloud | Managed HyperIndex |

## 1. Resolver

```
docker build -f packages/resolver/Dockerfile -t grain-resolver .
docker run -p 8787:8787 -e RPC_TESTNET_ENDPOINT=<rpc> grain-resolver
```

The image builds the daemon from source and fetches variant Q models at build
time, so nothing is downloaded at runtime.

| Variable | Purpose |
|---|---|
| `RPC_TESTNET_ENDPOINT` | Monad testnet RPC |
| `PORT` | defaults to 8787 |

Health check: `GET /health` returns the chain id, head block and record count.

## 2. Web app

Root directory `apps/web`. It is a pnpm workspace member, so the install and
build commands in `apps/web/vercel.json` run from the repo root.

| Variable | Exposed | Purpose |
|---|---|---|
| `RESOLVER_URL` | server | Where `/api/prepare` proxies watermarking |
| `NEXT_PUBLIC_RESOLVER_URL` | browser | Where `/verify` posts images |
| `NEXT_PUBLIC_RPC_URL` | browser | Registration transactions and "verify on chain" |
| `PRIVATE_KEY` | server | Funds new passkey accounts — see the warning below |

## The faucet is the thing to watch

`/api/fund` exists because SPEC §6.2 makes `msg.sender` the creator and SPEC §0
forbids crypto vocabulary: a passkey-derived account starts empty and a
photographer cannot fund it. A relayer would record the relayer as the creator
instead of the photographer, and meta-transactions need on-chain signature
recovery the spec rules out.

**On a public deployment this is a faucet, and it can be drained.** The balance
floor stops repeat claims from one address but not fresh addresses; the hourly
cap is in-memory, so it resets whenever the instance recycles. Both are speed
bumps, not guarantees.

That trade is right on testnet, where the funds have no value and the
alternative is no passkey onboarding at all. It is **not** right on mainnet, and
the README should say so plainly rather than leave a judge to find it.

Keep the deployer topped up; budget roughly 0.02 MON per new creator.

## What is not deployed

`pnpm seed` and `scripts/robustness-matrix.ts` are local tools. They need the
corpus and the fixtures, neither of which is redistributed — only fingerprints
ever reach the chain.

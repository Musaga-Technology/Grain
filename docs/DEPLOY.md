# Deploying

**The whole product runs on Vercel's free tier. There is no server to host.**

That was not the original design. The TrustMark models are 62 MB and must stay
loaded, so the first architecture put watermarking in a resolver container —
which needs about 1 GB of memory, more than any free host offers. Instead,
watermarking, fingerprinting and resolution now run in the visitor's browser
(onnxruntime-web, with Adobe's models served by the app itself), and the
browser reads Monad directly. See [RESOLVER.md](RESOLVER.md) for the server
path, which still works locally.

| Piece | Where |
|---|---|
| Web app, models, WASM runtime | Vercel, project root `apps/web` |
| Contracts | Monad testnet — `deployments/monad-testnet.json` |
| Faucet for new creators | `apps/web/app/api/fund`, the only server code |
| Indexer (optional accelerator) | Envio — see [INDEXER.md](INDEXER.md) |

## Deploy

```bash
./scripts/fetch-web-models.sh     # models + runtime into apps/web/public (gitignored)
vercel deploy --prod
```

The CLI upload must stay under Vercel Hobby's **100 MB**; the models and runtime
are ~73 MB of it. `.vercelignore` keeps everything else out — the corpus, the
fixtures, Rust builds.

| Variable | Exposed | Purpose |
|---|---|---|
| `NEXT_PUBLIC_RPC_URL` | browser | `https://testnet-rpc.monad.xyz`. Never a keyed RPC: `NEXT_PUBLIC_` values are shipped to every visitor |
| `FAUCET_PRIVATE_KEY` | server, sensitive | the faucet wallet — **never** the deployer |

## The faucet

A passkey account starts empty, and the no-wallet promise means a photographer
cannot fund it. A relayer would record the relayer as the creator; meta-
transactions need on-chain signature recovery the contracts don't do. So the
app funds a new account's first transactions: **0.05 MON**, enough for a name
(~107k gas) and a registration (~95–150k), only when the balance is below 0.03.

**It is a public faucet, and it can be drained.** That is why it is a
dedicated wallet holding a small balance (4 MON, about 80 creators) rather than
the deployer, and why the grant is small. The hourly cap is in memory and
resets when the instance recycles. Right for testnet; on mainnet someone has to
pay, and the funding model is an open question.

Top it up from the deployer when it runs low:

```bash
cast send <faucet address> --value 2ether --private-key <deployer key> --rpc-url https://testnet-rpc.monad.xyz
```

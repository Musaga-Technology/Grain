# Grain resolver: the C2PA Soft Binding Resolution API plus the TrustMark
# daemon, in one image.
#
# These ship together on purpose. The decoder is 45 MB and the encoder 17 MB,
# and both must stay resident -- a serverless function reloads them per request,
# which is the two seconds the daemon exists to remove. That is why this is a
# container and the Next.js app is not.

# ---------- build the daemon ----------
FROM rust:1.89-bookworm AS rust-build
WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# The daemon depends on Adobe's crate by path, so the source has to be present.
RUN git clone --depth 1 https://github.com/adobe/trustmark.git /build/trustmark-src

COPY packages/trustmarkd/Cargo.toml packages/trustmarkd/Cargo.lock /build/trustmarkd/
COPY packages/trustmarkd/src /build/trustmarkd/src

# Match the path dependency's layout: ../../.tools/trustmark-src/rust
RUN mkdir -p /build/.tools && ln -s /build/trustmark-src /build/.tools/trustmark-src
WORKDIR /build/trustmarkd
RUN cargo build --release

# ---------- fetch the models ----------
FROM debian:bookworm-slim AS models
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /models
# Variant Q only. The other variants are dead weight: an image encoded with one
# variant cannot be decoded with another.
RUN for m in decoder_Q.onnx encoder_Q.onnx; do \
      curl -fL --retry 5 --retry-all-errors \
        -o "$m" "https://cai-watermark.adobe.net/watermarking/trustmark-models/$m"; \
    done

# ---------- runtime ----------
FROM node:22-bookworm-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

COPY --from=rust-build /build/trustmarkd/target/release/trustmarkd /app/bin/trustmarkd
COPY --from=models /models /app/models

COPY pnpm-workspace.yaml package.json ./
COPY packages/grain-core ./packages/grain-core
COPY packages/resolver ./packages/resolver
COPY deployments ./deployments
RUN pnpm install --frozen-lockfile=false --prod=false

ENV TRUSTMARKD_BIN=/app/bin/trustmarkd \
    TRUSTMARK_MODELS=/app/models \
    GRAIN_DEPLOYMENTS=/app/deployments/monad-testnet.json \
    PORT=8787
EXPOSE 8787

# The daemon starts lazily on the first watermark request, so the first resolve
# after a cold start pays the model load and the rest do not.
CMD ["node", "--experimental-strip-types", "packages/resolver/src/server.ts"]

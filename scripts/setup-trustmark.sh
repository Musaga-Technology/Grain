#!/usr/bin/env bash
# Builds the TrustMark CLI and fetches the variant Q models.
#
# The official JavaScript build is decode-only, so encoding requires the Rust
# crate. Everything lands in .tools/ which is gitignored: the binary is ~33 MB
# and the models ~62 MB, neither of which belongs in git history.
#
# Only variant Q is fetched. `cargo xtask fetch-models` pulls all eight models
# and has no retry, so a truncated response part-way through leaves you with a
# corrupt file and a panic. Images encoded with one variant cannot be decoded
# with another, so the others are dead weight anyway.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS="$ROOT/.tools"
SRC="$TOOLS/trustmark-src"
MODELS="$TOOLS/models"
CDN="https://cai-watermark.adobe.net/watermarking/trustmark-models"

mkdir -p "$TOOLS" "$MODELS"

if [ ! -d "$SRC" ]; then
  echo "==> cloning adobe/trustmark"
  git clone --depth 1 https://github.com/adobe/trustmark.git "$SRC"
fi

echo "==> fetching variant Q models"
for m in decoder_Q.onnx encoder_Q.onnx; do
  expected=$(curl -sI "$CDN/$m" | awk 'BEGIN{IGNORECASE=1}/content-length/{gsub(/\r/,"");print $2}')
  actual=$(stat -f%z "$MODELS/$m" 2>/dev/null || stat -c%s "$MODELS/$m" 2>/dev/null || echo 0)
  if [ "$actual" = "$expected" ]; then
    echo "    $m already complete ($actual bytes)"
  else
    echo "    $m -> $expected bytes"
    curl -fL --retry 5 --retry-all-errors -o "$MODELS/$m" "$CDN/$m"
    got=$(stat -f%z "$MODELS/$m" 2>/dev/null || stat -c%s "$MODELS/$m")
    [ "$got" = "$expected" ] || { echo "SIZE MISMATCH: got $got want $expected"; exit 1; }
  fi
done

echo "==> building trustmark CLI (~10 min cold)"
cd "$SRC/rust"
cargo build --release -p trustmark-cli
cp target/release/trustmark "$TOOLS/trustmark"

echo "==> done"
echo "    binary: $TOOLS/trustmark"
echo "    models: $MODELS"
"$TOOLS/trustmark" --help | head -5

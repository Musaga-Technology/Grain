#!/usr/bin/env bash
# Places the TrustMark models where the web app serves them from (/models/).
#
# Why same-origin rather than Adobe's CDN: in a real browser the CDN was slow
# enough to serve the 45 MB decoder that requests failed part-way, and a failed
# response carries no CORS header, so Chrome reported a CORS block. Serving them
# from the app's own origin removes both the latency and CORS from the picture.
# The models are MIT-licensed (adobe/trustmark).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/apps/web/public/models"
CDN="https://cai-watermark.adobe.net/watermarking/trustmark-models"
mkdir -p "$DEST"
for m in encoder_Q.onnx decoder_Q.onnx resizer.onnx; do
  if [ -f "$ROOT/.tools/models/$m" ]; then cp "$ROOT/.tools/models/$m" "$DEST/$m"; echo "copied $m"
  elif [ ! -f "$DEST/$m" ]; then curl -fL --retry 5 --retry-all-errors -o "$DEST/$m" "$CDN/$m"; echo "fetched $m"; fi
done

# The onnxruntime-web WASM runtime, also served same-origin. The plain WASM
# build (11 MB), not the default bundle's WebGPU build (22 MB): Grain only uses
# the WASM backend, and jsDelivr reset a 22 MB download mid-transfer in testing.
ORT_DIST="$(ls -d "$ROOT"/node_modules/.pnpm/onnxruntime-web@1.20.1*/node_modules/onnxruntime-web/dist | head -1)"
mkdir -p "$ROOT/apps/web/public/ort"
cp "$ORT_DIST/ort-wasm-simd-threaded.wasm" "$ORT_DIST/ort-wasm-simd-threaded.mjs" "$ROOT/apps/web/public/ort/"
echo "copied onnxruntime-web runtime"

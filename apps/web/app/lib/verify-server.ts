import 'server-only';
import { decodeWatermark, useModelBytes } from './trustmark';
import { verifyImage } from '../../../../plugins/mm-grain/src/lib/grain.ts';
import { toResult, type VerifyResult } from '../../../../plugins/mm-grain/src/lib/format.ts';

/**
 * Who made this image -- the one check behind the website, the verify API, the
 * MCP server and `mm grain verify`. It runs grain-core's verdict logic, the
 * website's TrustMark port, and Envio with a chain fallback, so every way of
 * asking Grain gives the same answer.
 */

// The TrustMark decoder (45 MB) and resizer, fetched from this deployment once per warm instance.
let models: Promise<void> | undefined;
function loadModels(origin: string): Promise<void> {
  models ??= Promise.all(['decoder_Q.onnx', 'resizer.onnx'].map(async (file) => {
    const res = await fetch(`${origin}/models/${file}`);
    if (!res.ok) throw new Error(`model ${file}: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  })).then(([decoder, resizer]) => useModelBytes({ decoder, resizer }));
  models.catch(() => { models = undefined; });
  return models;
}

export async function checkImage(bytes: Uint8Array, origin: string): Promise<VerifyResult> {
  await loadModels(origin);
  return toResult(await verifyImage(bytes, decodeWatermark));
}

export type { VerifyResult };

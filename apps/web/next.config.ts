import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The verify API (app/api/v1/verify) runs TrustMark on the server. The
  // runtime loads its own .wasm from its package folder, so it stays a real
  // node_modules dependency rather than being bundled.
  serverExternalPackages: ['onnxruntime-web'],
  outputFileTracingIncludes: {
    '/api/v1/verify': ['../../node_modules/.pnpm/onnxruntime-web@*/node_modules/onnxruntime-web/dist/*.{wasm,mjs}'],
  },
  webpack(config, { isServer }) {
    if (isServer) {
      // onnxruntime-web's WASM-only build declares "node": null in its exports,
      // so the server cannot load it by that name. The full package is the
      // same runtime and does load in Node, as the MetaMask plugin does.
      const mapOrt = ({ request }: { request?: string }, callback: (err?: null, result?: string) => void) =>
        request === 'onnxruntime-web/wasm' ? callback(null, 'commonjs onnxruntime-web') : callback();
      config.externals = [mapOrt, ...(Array.isArray(config.externals) ? config.externals : [config.externals])];
    }
    return config;
  },
  async headers() {
    return [
      {
        // The models never change under a given name; let browsers keep them.
        // The decoder is 45 MB, so this is the difference between paying for it
        // once and paying for it on every visit.
        source: '/models/:file*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/ort/:file*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};

export default nextConfig;

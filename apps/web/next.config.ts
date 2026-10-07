import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack(config, { isServer }) {
    if (isServer) {
      // onnxruntime-web's WASM-only build declares "node": null in its exports,
      // so the server bundle cannot resolve it. It never needs to: watermarking
      // runs in the browser, from event handlers and effects, never during the
      // server render. Resolving it to nothing on the server is exact.
      config.resolve.alias = { ...config.resolve.alias, 'onnxruntime-web/wasm$': false };
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

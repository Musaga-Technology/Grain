import { defineChain } from 'viem';
import deployments from '../../../../deployments/monad-testnet.json';

export const monadTestnet = defineChain({
  id: deployments.chainId,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_RPC_URL ?? ''] } },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
});

export const CONTRACTS = deployments.contracts as {
  GrainRegistry: `0x${string}`;
  FingerprintIndex: `0x${string}`;
  CreatorRegistry: `0x${string}`;
  LicenseRegistry: `0x${string}`;
};

export const registryAbi = [
  {
    type: 'function', name: 'register', stateMutability: 'nonpayable',
    inputs: [
      { name: 'expectedRecordId', type: 'uint64' },
      { name: 'fingerprint', type: 'uint64' },
      { name: 'manifest', type: 'bytes' },
    ],
    outputs: [{ type: 'uint64' }],
  },
] as const;

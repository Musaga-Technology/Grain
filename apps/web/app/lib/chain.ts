import { defineChain } from 'viem';
import deployments from '../../../../deployments/monad-testnet.json';

export const monadTestnet = defineChain({
  id: deployments.chainId,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_RPC_URL ?? ''] } },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
});

export const CONTRACTS = {
  ...deployments.contracts,
  // Local development seals into a separate test anchor, never production's:
  // a seal is permanent, and test events must not become part of the record.
  ActivityAnchor: process.env.NEXT_PUBLIC_ANCHOR_ADDRESS ?? deployments.contracts.ActivityAnchor,
} as {
  GrainRegistry: `0x${string}`;
  FingerprintIndex: `0x${string}`;
  CreatorRegistry: `0x${string}`;
  LicenseRegistry: `0x${string}`;
  ActivityAnchor: `0x${string}`;
};

export const anchorAbi = [
  {
    type: 'function', name: 'sealCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'seals', stateMutability: 'view',
    inputs: [{ name: 'index', type: 'uint256' }],
    outputs: [{ type: 'tuple', components: [
      { name: 'from', type: 'uint64' }, { name: 'until', type: 'uint64' },
      { name: 'events', type: 'uint32' }, { name: 'root', type: 'bytes32' },
    ] }],
  },
  {
    type: 'function', name: 'latest', stateMutability: 'view', inputs: [],
    outputs: [{ type: 'tuple', components: [
      { name: 'from', type: 'uint64' }, { name: 'until', type: 'uint64' },
      { name: 'events', type: 'uint32' }, { name: 'root', type: 'bytes32' },
    ] }],
  },
  {
    type: 'function', name: 'seal', stateMutability: 'nonpayable',
    inputs: [{ name: 'until', type: 'uint64' }, { name: 'events', type: 'uint32' }, { name: 'root', type: 'bytes32' }],
    outputs: [],
  },
] as const;

export const indexAbi = [
  {
    type: 'function', name: 'verify', stateMutability: 'view',
    inputs: [
      { name: 'recordId', type: 'uint64' },
      { name: 'queryFingerprint', type: 'uint64' },
    ],
    outputs: [{ type: 'uint8' }],
  },
] as const;

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

export const creatorAbi = [
  {
    type: 'function', name: 'creators', stateMutability: 'view',
    inputs: [{ name: 'creator', type: 'address' }],
    outputs: [{ type: 'tuple', components: [
      { name: 'handle', type: 'string' },
      { name: 'profileURI', type: 'string' },
      { name: 'licensePriceWei', type: 'uint256' },
    ] }],
  },
  {
    type: 'function', name: 'handleOwner', stateMutability: 'view',
    inputs: [{ name: 'handleHash', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function', name: 'setProfile', stateMutability: 'nonpayable',
    inputs: [
      { name: 'handle', type: 'string' },
      { name: 'profileURI', type: 'string' },
      { name: 'licensePriceWei', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

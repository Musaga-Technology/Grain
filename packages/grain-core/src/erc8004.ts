import { parseAbi, type Hex, type PublicClient } from 'viem';
import type { AgentAssertion } from './manifest.ts';

/**
 * ERC-8004 agent identities, read from the chain.
 *
 * A manifest's `agent` assertion is a claim made by the manifest's signer.
 * It is only shown as verified when the chain agrees: the signer must own the
 * agent (its ERC-721 owner) or be the agent's registered wallet. Anyone can
 * write any agent id into a manifest; nobody can make the registry say they
 * control it.
 */

export const identityAbi = parseAbi([
  'function register(string agentURI) returns (uint256 agentId)',
  'function ownerOf(uint256 agentId) view returns (address)',
  'function tokenURI(uint256 agentId) view returns (string)',
  'function getAgentWallet(uint256 agentId) view returns (address)',
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
]);

export const reputationAbi = parseAbi([
  'function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)',
  'function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)',
  'function getClients(uint256 agentId) view returns (address[])',
]);

export interface AgentIdentity {
  registry: Hex;
  agentId: bigint;
  owner: Hex;
  wallet: Hex | null;
  uri: string;
  name?: string;
  description?: string;
  image?: string;
}

/** "eip155:10143:0x8004..." -> the address, if the chain matches. */
export function registryAddress(a: AgentAssertion, chainId: number): Hex | null {
  const m = a.registry.match(/^eip155:(\d+):(0x[0-9a-fA-F]{40})$/);
  return m && Number(m[1]) === chainId ? (m[2] as Hex) : null;
}

/** The agent's registration file: a data: URI read in place, https fetched, anything else skipped. */
async function registrationFile(uri: string): Promise<Record<string, unknown> | null> {
  try {
    if (uri.startsWith('data:')) {
      const [meta, body] = uri.slice(5).split(',', 2);
      const text = meta.endsWith(';base64') ? new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0))) : decodeURIComponent(body);
      return JSON.parse(text);
    }
    if (uri.startsWith('https://')) {
      const res = await fetch(uri, { signal: AbortSignal.timeout(4000) });
      return res.ok ? await res.json() : null;
    }
  } catch { /* unreadable file: show the id without a name */ }
  return null;
}

export async function readAgent(client: PublicClient, registry: Hex, agentId: bigint): Promise<AgentIdentity | null> {
  try {
    const [owner, uri, wallet] = await Promise.all([
      client.readContract({ address: registry, abi: identityAbi, functionName: 'ownerOf', args: [agentId] }),
      client.readContract({ address: registry, abi: identityAbi, functionName: 'tokenURI', args: [agentId] }),
      client.readContract({ address: registry, abi: identityAbi, functionName: 'getAgentWallet', args: [agentId] }).catch(() => null),
    ]);
    const file = await registrationFile(uri);
    const zero = /^0x0{40}$/i;
    return {
      registry, agentId, owner, uri,
      wallet: wallet && !zero.test(wallet) ? wallet : null,
      name: typeof file?.name === 'string' ? file.name.slice(0, 80) : undefined,
      description: typeof file?.description === 'string' ? file.description.slice(0, 280) : undefined,
      image: typeof file?.image === 'string' ? file.image : undefined,
    };
  } catch {
    return null; // no such agent, or the registry isn't reachable
  }
}

/** Whether `address` speaks for the agent: its owner, or its registered wallet. */
export function controlsAgent(agent: AgentIdentity, address: string): boolean {
  const a = address.toLowerCase();
  return agent.owner.toLowerCase() === a || agent.wallet?.toLowerCase() === a;
}

/** An ERC-8004 registration file, as a data: URI (no hosting needed). */
export function registrationUri(fields: { name: string; description?: string; image?: string; services?: unknown[] }): string {
  const file = {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: fields.name,
    ...(fields.description ? { description: fields.description } : {}),
    ...(fields.image ? { image: fields.image } : {}),
    services: fields.services ?? [],
  };
  const bytes = new TextEncoder().encode(JSON.stringify(file));
  return `data:application/json;base64,${btoa(String.fromCharCode(...bytes))}`;
}

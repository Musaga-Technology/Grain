import type { PublicClient } from 'viem';
import { controlsAgent, readAgent, registryAddress, type AgentAssertion } from '@grain/core';

/**
 * The ERC-8004 agent a record says generated it, checked against the chain.
 * `verified` is true only when the record's creator owns the agent or is its
 * registered wallet: anyone can write an agent id into a manifest, but only
 * the registry can say who controls it.
 */
export interface AgentView {
  agentId: string;
  name?: string;
  verified: boolean;
  owner?: string;
}

export async function agentFor(
  client: PublicClient, chainId: number,
  manifest: { assertions?: { agent?: AgentAssertion } } | undefined, creator: string,
): Promise<AgentView | undefined> {
  const claim = manifest?.assertions?.agent;
  if (!claim?.agentId) return undefined;
  const registry = registryAddress(claim, chainId);
  if (!registry) return { agentId: claim.agentId, verified: false };
  const agent = await readAgent(client, registry, BigInt(claim.agentId));
  if (!agent) return { agentId: claim.agentId, verified: false };
  return { agentId: claim.agentId, name: agent.name, owner: agent.owner, verified: controlsAgent(agent, creator) };
}

/**
 * Who to credit, by name: the creator's handle, or else -- for an agent's
 * work -- the name of a verified ERC-8004 agent. An unverified claim never
 * names anyone: anyone can write an agent id into a manifest.
 */
export function creditName(handle: string | null | undefined, agent?: AgentView | null): string {
  if (handle) return `@${handle}`;
  if (agent?.verified && agent.name) return agent.name;
  return 'an unnamed creator';
}

import { keccak256, namehash, toBytes } from 'viem';

// D-07 entropy source: b = keccak256(namehash(name)).slice(0, 6)
// Mirrors the contract-side namehash so a future on-chain renderer derives
// the exact same bytes from the exact same name.
export function nameBytes(name: string): number[] {
  const node = namehash(name); // EIP-137 node, 32 bytes
  const digest = keccak256(node); // hash the node again per the deck spec
  return Array.from(toBytes(digest).slice(0, 6));
}

// Stable, collision-resistant-enough id fragment for scoping SVG defs
// when multiple avatars are embedded in one document (e.g. the OG card).
export function idSuffix(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

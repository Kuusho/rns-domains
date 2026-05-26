import { artifacts, deployScript } from '@rocketh'
import { labelhash, namehash } from 'viem'

// Phase 6 ROOT HANDOFF — assigns the `addr.reverse` subnode of the registry to
// the new ReverseRegistrar. Mirrors Phase 3's `00_setup_rise_registrar.ts`
// step 3b's Pitfall 3 signing posture, but with the 2-step seating required by
// the fact that `addr.reverse` is a TWO-LEVEL subnode under root (vs. the
// one-level `.rise` TLD subnode).
//
// CRITICAL — Pitfall 3 (06-RESEARCH.md Common Pitfalls):
//   The first write is signed by `deployer`, NOT `owner`. Phase 2's
//   `00_setup_root.ts` registered the DEPLOYER (not the named owner) as the
//   RNSRoot controller. RNSRoot.setSubnodeOwner is `onlyController` (NOT
//   onlyOwner), so it must be called from the registered controller's key —
//   the deployer. Signing with `owner` would revert with "Controllable: Caller
//   is not a controller".
//
//   The SECOND write writes directly into the registry (NOT through RNSRoot)
//   because the parent node is `namehash('reverse')` — NOT the registry root.
//   That parent's owner (after step 1) is the deployer, and `RNSRegistry.setSubnodeOwner`
//   is gated by `authorised(parent)` (msg.sender is the parent's owner OR
//   approved). The deployer signs this too.
//
// Defensive measure: this script destructures ONLY `deployer` from
// namedAccounts. The owner-signed write path is syntactically unavailable in
// this file — any future-developer edit that tries to switch to owner has to
// add `owner` to the destructure first, which is a visible review surface.
//
// Post-condition (REG-06 deploy-state — Plan 06-05 D-12 closure-gate verifier
// point 1):
//   - RNSRegistry.owner(namehash('addr.reverse')) == ReverseRegistrar.address
//
// Why 2 steps:
//   - `addr.reverse` is namehash('addr.reverse') = keccak256(namehash('reverse'),
//     labelhash('addr')). The reverse-registrar must own this NODE — not just
//     `namehash('reverse')` — because its writes (`claim`, `setName`,
//     `setNameForAddr`) all call `rns.setSubnodeRecord(ADDR_REVERSE_NODE, ...)`,
//     which is gated by `authorised(ADDR_REVERSE_NODE)`. The 2-step plants the
//     subnode tree exactly as the reference ENS test fixture does
//     (reference/ens-contracts/test/reverseRegistrar/TestReverseRegistrar.ts
//     lines 33-42 — the canonical pattern).
//
// Re-run caveat: setSubnodeOwner is idempotent at the registry level — re-
// running on a populated node silently re-writes (no revert). Matches Phase 3
// posture.
export default deployScript(
  async ({ get, execute: write, namedAccounts: { deployer } }) => {
    const root = get<(typeof artifacts.RNSRoot)['abi']>('RNSRoot')
    const registry = get<(typeof artifacts.RNSRegistry)['abi']>('RNSRegistry')
    const reverseRegistrar = get<
      (typeof artifacts.ReverseRegistrar)['abi']
    >('ReverseRegistrar')

    // Step 1 — through RNSRoot (because the root NODE 0x0 is owned by RNSRoot,
    // and RNSRoot.setSubnodeOwner is the only way to mutate root-children).
    // Seat namehash('reverse') under the DEPLOYER so the deployer can perform
    // step 2 inside the registry.
    console.log(
      '  - Setting owner of reverse subnode (parent) to deployer on RNSRoot',
    )
    await write(root, {
      functionName: 'setSubnodeOwner',
      args: [labelhash('reverse'), deployer],
      account: deployer, // PITFALL 3 — deployer, NOT owner
    })

    // Step 2 — directly into the registry, signed by the deployer (who now
    // owns the `namehash('reverse')` parent node from step 1). Seats
    // `addr.reverse` (== keccak256(namehash('reverse'), labelhash('addr')))
    // owned by ReverseRegistrar.
    console.log(
      '  - Setting owner of addr.reverse subnode to ReverseRegistrar on RNSRegistry',
    )
    await write(registry, {
      functionName: 'setSubnodeOwner',
      args: [namehash('reverse'), labelhash('addr'), reverseRegistrar.address],
      account: deployer, // PITFALL 3 — deployer (parent-node owner from step 1)
    })
  },
  {
    id: 'AddrReverse:setup v1.0.0',
    tags: ['category:reverseregistrar', 'AddrReverse:setup'],
    dependencies: ['RNSRoot:setup', 'ReverseRegistrar:contract'],
  },
)

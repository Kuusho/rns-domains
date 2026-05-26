import { artifacts, deployScript } from '@rocketh'
import { labelhash } from 'viem'

// Phase 6 ROOT HANDOFF — assigns the addr.reverse subnode of the registry root
// to the new ReverseRegistrar. Mirrors Phase 3's `00_setup_rise_registrar.ts`
// step 3b verbatim — same root-mediated subnode-owner pattern, same Pitfall 3
// signing posture.
//
// CRITICAL — Pitfall 3 (06-RESEARCH.md Common Pitfalls):
//   The write is signed by `deployer`, NOT `owner`. Phase 2's
//   `00_setup_root.ts` registered the DEPLOYER (not the named owner) as the
//   RNSRoot controller. RNSRoot.setSubnodeOwner is `onlyController` (NOT
//   onlyOwner), so it must be called from the registered controller's key —
//   the deployer. Signing with `owner` would revert with "Controllable: Caller
//   is not a controller".
//
// Defensive measure: this script destructures ONLY `deployer` from
// namedAccounts. The owner-signed write path is syntactically unavailable in
// this file — any future-developer edit that tries to switch to owner has to
// add `owner` to the destructure first, which is a visible review surface.
//
// Post-condition (REG-06 deploy-state):
//   - RNSRegistry.owner(namehash('addr.reverse')) == ReverseRegistrar.address
//
// Re-run caveat: the bare setSubnodeOwner call is NOT guarded by a current-
// owner read. Re-running on a populated node silently re-writes the same
// address (idempotent at the registry level — no revert, just a redundant
// tx). Matches Phase 3 posture.
export default deployScript(
  async ({ get, execute: write, namedAccounts: { deployer } }) => {
    const root = get<(typeof artifacts.RNSRoot)['abi']>('RNSRoot')
    const reverseRegistrar = get<
      (typeof artifacts.ReverseRegistrar)['abi']
    >('ReverseRegistrar')

    console.log(
      '  - Setting owner of addr.reverse subnode to ReverseRegistrar on RNSRoot',
    )
    await write(root, {
      functionName: 'setSubnodeOwner',
      args: [labelhash('reverse'), reverseRegistrar.address],
      account: deployer, // PITFALL 3 — deployer, NOT owner
    })
  },
  {
    id: 'AddrReverse:setup v1.0.0',
    tags: ['category:reverseregistrar', 'AddrReverse:setup'],
    dependencies: ['RNSRoot:setup', 'ReverseRegistrar:contract'],
  },
)

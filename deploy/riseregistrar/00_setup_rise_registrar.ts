import { artifacts, deployScript } from '@rocketh'
import { labelhash } from 'viem'

// THE ACTIVATION GATE (D-02). Re-created from the reference ethregistrar setup script.
//
// Two divergences from the reference:
//   1. The reference TLD labelhash literal is replaced by the rise TLD labelhash (spec §6.1).
//   2. RNSRoot.setSubnodeOwner is signed by the deployer, NOT the named owner (RESEARCH Pitfall 2).
//      Phase 2's root setup script registers the deployer (NOT the named owner) as the
//      RNSRoot controller. Calling from the alternate named account would revert with
//      "Controllable: Caller is not a controller".
//
// Steps (in order):
//   3a. registrar.transferOwnership(securityController.address) signed by the deployer
//       (the deployer is the registrar's current owner — OZ Ownable seated it in the
//       previous deploy script).
//   3b. RNSRoot.setSubnodeOwner with the rise labelhash and the registrar address, signed
//       by the deployer (a registered RNSRoot controller per Phase 2 — Pitfall 2).
//
// Post-condition (TLD-01 satisfied):
//   - RNSRegistry.owner(namehash('rise')) == RiseRegistrar.address
//   - RiseRegistrar.live modifier passes (rns.owner(baseNode) == address(this))
//   - RiseRegistrar is owned by RegistrarSecurityController (which is owned by the named
//     owner account)
//
// Re-run caveat: the bare ownership-transfer calls are NOT guarded by current-owner reads —
// the reference script doesn't guard them either, and the intended deploy flow is
// `bun run deploy:local` against a clean local node. Re-running on a populated node may
// surface an OZ Ownable revert on step 3a; Phase 6 hardening can add guards
// if this becomes operationally painful.
export default deployScript(
  async ({ get, execute: write, namedAccounts: { deployer } }) => {
    const root = get<(typeof artifacts.RNSRoot)['abi']>('RNSRoot')
    const registrar = get<(typeof artifacts.RiseRegistrar)['abi']>('RiseRegistrar')
    const registrarSecurityController = get<
      (typeof artifacts.RegistrarSecurityController)['abi']
    >('RegistrarSecurityController')

    // Step 3a: Hand registrar ownership to the RegistrarSecurityController.
    console.log(
      '  - Transferring ownership of RiseRegistrar to RegistrarSecurityController',
    )
    await write(registrar, {
      functionName: 'transferOwnership',
      args: [registrarSecurityController.address],
      account: deployer,
    })

    // Step 3b: Assign .rise to the registrar on RNSRoot. CRITICALLY signs with
    // the deployer account (NOT the alternate named account like the reference) — Phase 2's
    // 00_setup_root.ts registered the DEPLOYER as the RNSRoot controller,
    // not the alternate account. Pitfall 2 in 03-RESEARCH.md documents this divergence.
    console.log('  - Setting owner of .rise node to RiseRegistrar on RNSRoot')
    await write(root, {
      functionName: 'setSubnodeOwner',
      args: [labelhash('rise'), registrar.address],
      account: deployer,
    })
  },
  {
    id: 'RiseRegistrar:setup v1.0.0',
    tags: ['category:riseregistrar', 'RiseRegistrar', 'RiseRegistrar:setup'],
    dependencies: [
      'RNSRoot:setup',
      'RiseRegistrar:contract',
      'RegistrarSecurityController:contract',
    ],
  },
)

import { artifacts, deployScript } from '@rocketh'

// Phase 4 ACTIVATION GATE — closes RES-07 by assigning RiseOwnedResolver as the
// resolver for the .rise node.
//
// CRITICAL — Pitfall 2 (04-RESEARCH.md lines 313-321): this script signs with the
// named `owner` account, NOT `deployer`. The reason diverges from Phase 3's
// 00_setup_rise_registrar.ts:
//
//   - Phase 3's setup signs RNSRoot.setSubnodeOwner with `deployer` because
//     Phase 2's setup script registered the deployer as an RNSRoot controller via
//     the RNSControllable mixin (a mutable controller list). RNSRoot uses
//     `onlyController`, not `onlyOwner`.
//
//   - Phase 4's setup signs SC.setRegistrarResolver with `owner` because
//     `RegistrarSecurityController.setRegistrarResolver` is `onlyOwner`
//     (OZ Ownable), and the SC's owner was set to the named `owner` account by
//     Phase 3's 00_deploy_registrar_security_controller.ts. Signing with
//     `deployer` would revert with "Ownable: caller is not the owner".
//
// Forward chain after a successful write:
//   1. SC.setRegistrarResolver(riseOwnedResolver.address)         ← signed by `owner` (this script)
//   2. → registrar.setResolver(riseOwnedResolver.address)          ← onlyOwner; SC IS the registrar's owner (Phase 3 activation gate)
//   3. → rns.setResolver(namehash('rise'), riseOwnedResolver.address)   ← registrar IS rns.owner('rise') (Phase 3 activation gate)
//
// Post-condition: rns.resolver(namehash('rise')) == RiseOwnedResolver.address —
// RES-07 satisfied.
//
// Forward note (RESEARCH Open Question 3): no `setResolver(public-resolver.rise, ...)`
// self-resolving record is written in Phase 4 — that would require registering the
// `.rise` 2LD first, which happens in Phase 6 via RiseRegistrarController.
//
// Idempotency: not pre-read-guarded (matches Phase 3 setup posture). A re-run
// silently re-writes the same address (no revert, just a redundant tx). Phase 6
// hardening can add a `if (rns.resolver(baseNode) === riseOwnedResolver.address) return;`
// guard if needed.
//
// Note the destructure below pulls in `owner` only — `deployer` is intentionally
// NOT destructured here, making any deployer-signed write syntactically
// unavailable in this file (defensive measure against accidental edits —
// owner, NOT deployer).
export default deployScript(
  async ({ get, execute: write, namedAccounts: { owner } }) => {
    const securityController = get<(typeof artifacts.RegistrarSecurityController)['abi']>(
      'RegistrarSecurityController',
    )
    const riseOwnedResolver = get<(typeof artifacts.RiseOwnedResolver)['abi']>(
      'RiseOwnedResolver',
    )

    console.log(
      '  - Setting RiseOwnedResolver as the resolver for the .rise node',
    )
    await write(securityController, {
      functionName: 'setRegistrarResolver',
      args: [riseOwnedResolver.address],
      account: owner, // PITFALL 2 — owner, NOT deployer
    })
  },
  {
    id: 'Resolution:setup v1.0.0',
    tags: ['category:resolver', 'Resolution:setup'],
    dependencies: [
      'RegistrarSecurityController:contract',
      'RiseOwnedResolver:contract',
      'RiseRegistrar:setup', // CRITICAL: activation gate must have already run — registrar must own .rise
    ],
  },
)

import { artifacts, deployScript } from '@rocketh'

// Phase 6 ACTIVATION GATE for REG-13 — closes the "RiseRegistrarController is
// registered as an authorized controller on the registrar and both reverse
// registrars" requirement.
//
// CRITICAL — Pitfall 2 (06-RESEARCH.md Common Pitfalls + Phase 4
// 04-05-SUMMARY.md):
//   All three writes sign with the named `owner` account, NOT `deployer`. The
//   targets are all `onlyOwner`-gated setters on contracts whose OZ Ownable
//   owner was rotated from deployer → owner via the prior deploy scripts'
//   transferOwnership(owner) calls. Signing with `deployer` would revert with
//   "Ownable: caller is not the owner".
//
//   Defensive measure: this script destructures ONLY `owner` from
//   namedAccounts. The deployer-signed path is syntactically unavailable in
//   this file — any future-developer edit that tries to switch to deployer
//   has to add `deployer` to the destructure first, which is a visible
//   review surface.
//
// Forward chain after a successful execution (REG-13 closure):
//   1. sc.addRegistrarController(controller) signed by owner
//      → registrar.addController(controller) (onlyOwner; SC IS the registrar's
//        owner after Phase 3's activation gate)
//      → registrar.controllers[controller] = true (REG-13 part 1)
//   2. reverseRegistrar.setController(controller, true) signed by owner
//      → reverseRegistrar.controllers[controller] = true (REG-13 part 2)
//   3. defaultReverseRegistrar.setController(controller, true) signed by owner
//      → defaultReverseRegistrar.controllers[controller] = true (REG-13 part 3)
//
// Idempotency: re-running is safe — each write is to a boolean mapping;
// setting an already-true value is a no-op tx (no revert, just a redundant
// write). Matches Phase 4 00_setup_resolution.ts posture.
//
// The addr.reverse root-handoff is in the dependency list — REG-13 wiring
// can't proceed without the addr.reverse subnode being owned by
// ReverseRegistrar (otherwise the reverse-record write path from the
// controller wouldn't have a node to write under).
export default deployScript(
  async ({ get, execute: write, namedAccounts: { owner } }) => {
    const sc = get<
      (typeof artifacts.RegistrarSecurityController)['abi']
    >('RegistrarSecurityController')
    const controller = get<
      (typeof artifacts.RiseRegistrarController)['abi']
    >('RiseRegistrarController')
    const reverseRegistrar = get<
      (typeof artifacts.ReverseRegistrar)['abi']
    >('ReverseRegistrar')
    const defaultReverseRegistrar = get<
      (typeof artifacts.DefaultReverseRegistrar)['abi']
    >('DefaultReverseRegistrar')

    // REG-13 part 1 — controller on RiseRegistrar via SC's owner-only forward
    console.log(
      '  - Registering RiseRegistrarController as controller on RiseRegistrar via RegistrarSecurityController',
    )
    await write(sc, {
      functionName: 'addRegistrarController',
      args: [controller.address],
      account: owner, // PITFALL 2 — owner, NOT deployer
    })

    // REG-13 part 2 — controller on ReverseRegistrar
    console.log(
      '  - Registering RiseRegistrarController as controller on ReverseRegistrar',
    )
    await write(reverseRegistrar, {
      functionName: 'setController',
      args: [controller.address, true],
      account: owner, // PITFALL 2 — owner, NOT deployer
    })

    // REG-13 part 3 — controller on DefaultReverseRegistrar
    console.log(
      '  - Registering RiseRegistrarController as controller on DefaultReverseRegistrar',
    )
    await write(defaultReverseRegistrar, {
      functionName: 'setController',
      args: [controller.address, true],
      account: owner, // PITFALL 2 — owner, NOT deployer
    })
  },
  {
    id: 'RiseRegistrarController:setup v1.0.0',
    tags: ['category:registrar-controller', 'RiseRegistrarController:setup'],
    dependencies: [
      'RiseRegistrarController:contract',
      'ReverseRegistrar:contract',
      'DefaultReverseRegistrar:contract',
      'RegistrarSecurityController:contract',
      'AddrReverse:setup',
      // RiseRegistrar:setup is required — Phase 3's activation gate must have
      // already transferred registrar ownership to RegistrarSecurityController,
      // otherwise sc.addRegistrarController reverts because SC isn't yet the
      // registrar's owner. Without this dep, rocketh's lazy resolver skips the
      // Phase 3 setup script and the deploy chain breaks at this script.
      'RiseRegistrar:setup',
      // Resolution:setup completes the .rise resolver wiring (Phase 4
      // activation gate). REG-13 itself doesn't need it, but the full Phase
      // 2-6 deploy:local chain must include it for the controller's
      // resolver-multicall path (REG-04) to work post-deploy. Pulling it in
      // via this script's deps makes `bun run deploy:local` execute the full
      // 16-script chain end-to-end.
      'Resolution:setup',
    ],
  },
)

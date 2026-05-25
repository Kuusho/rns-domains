import { artifacts, deployScript } from '@rocketh'

// Re-created from the reference ethregistrar SC deploy script,
// simplified to RNS scope (D-02):
//   - the `!use_root` early-return guard is deleted;
//   - the reference registrar artifact name is replaced by RiseRegistrar (the type the SC holds).
// Contract name stays `RegistrarSecurityController` un-prefixed (Phase 2 D-11 specifics /
// CONTEXT.md <specifics>). With the two-account model (Phase 2 D-14 — the named owner is at
// Hardhat index 1, distinct from the deployer at index 0) the ownership-handoff branch
// ALWAYS runs locally — a real handoff, never skipped.
// Post-condition: RegistrarSecurityController.owner() == the named owner account.
// RiseRegistrar.owner() is still `deployer` at this point — handed to SC in 00_setup_rise_registrar.ts.
export default deployScript(
  async ({ deploy, get, execute: write, namedAccounts: { deployer, owner } }) => {
    const registrar = get<(typeof artifacts.RiseRegistrar)['abi']>('RiseRegistrar')

    const securityController = await deploy('RegistrarSecurityController', {
      account: deployer,
      artifact: artifacts.RegistrarSecurityController,
      args: [registrar.address],
    })

    if (!securityController.newlyDeployed) return

    if (owner && owner !== deployer) {
      console.log(
        `  - Transferring ownership of RegistrarSecurityController to ${owner}`,
      )
      await write(securityController, {
        functionName: 'transferOwnership',
        args: [owner],
        account: deployer,
      })
    }
  },
  {
    id: 'RegistrarSecurityController v1.0.0',
    tags: ['category:riseregistrar', 'RegistrarSecurityController', 'RegistrarSecurityController:contract'],
    dependencies: ['RiseRegistrar:contract'],
  },
)

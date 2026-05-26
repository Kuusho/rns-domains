import { artifacts, deployScript } from '@rocketh'
import { zeroAddress } from 'viem'

// Re-created from the reference resolvers deploy script (00_deploy_public_resolver.ts),
// simplified to Phase 4 RNS scope (D-01 / D-09):
//   - the reference 4-slot constructor (RNS, address trustedETHController, address
//     trustedReverseRegistrar, INameWrapper) is collapsed to the RNS 3-slot form
//     (RNS, address trustedRiseController, address trustedReverseRegistrar) — no
//     NameWrapper slot. Both trusted-address slots are passed as address(0) at
//     Phase 4 deploy time: Phase 6 wires the real RiseRegistrarController and
//     ReverseRegistrar via the owner-only setters `setTrustedController(address)` and
//     `setTrustedReverseRegistrar(address)`.
//   - OZ Ownable v4.9.3 seats `deployer` as the initial owner. With the two-account
//     model (D-14 — the named `owner` is at Hardhat index 1, distinct from `deployer`
//     at index 0) the ownership-handoff branch ALWAYS runs locally. Post-condition:
//     PublicResolver.owner() == the named `owner` account.
//   - Mirrors deploy/riseregistrar/00_deploy_registrar_security_controller.ts in shape
//     (newlyDeployed guard + `if (owner && owner !== deployer)` transferOwnership branch).
export default deployScript(
  async ({ deploy, get, execute: write, namedAccounts: { deployer, owner } }) => {
    const registry = get<(typeof artifacts.RNSRegistry)['abi']>('RNSRegistry')

    const publicResolver = await deploy('PublicResolver', {
      account: deployer,
      artifact: artifacts.PublicResolver,
      args: [registry.address, zeroAddress, zeroAddress],
    })

    if (!publicResolver.newlyDeployed) return

    if (owner && owner !== deployer) {
      console.log(`  - Transferring ownership of PublicResolver to ${owner}`)
      await write(publicResolver, {
        functionName: 'transferOwnership',
        args: [owner],
        account: deployer,
      })
    }
  },
  {
    id: 'PublicResolver v1.0.0',
    tags: ['category:resolver', 'PublicResolver', 'PublicResolver:contract'],
    dependencies: ['RNSRegistry'],
  },
)

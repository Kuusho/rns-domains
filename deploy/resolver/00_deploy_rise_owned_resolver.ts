import { artifacts, deployScript } from '@rocketh'

// Re-created from the reference resolvers deploy script (00_deploy_owned_resolver.ts),
// simplified to Phase 4 RNS scope (D-04 / D-09 / Pitfall 9):
//   - RiseOwnedResolver has no constructor args (OZ Ownable v4.9.3 seats msg.sender);
//   - RiseOwnedResolver does NOT read the registry, so the rocketh `dependencies`
//     array is empty per D-09 (unlike PublicResolver which depends on RNSRegistry);
//   - Post-deploy, ownership is transferred to the named `owner` account immediately
//     — matches Phase 3 D-14's distinct-account pattern and the PublicResolver deploy
//     script in this directory.
//   - The `.rise` node activation gate (calling SC.setRegistrarResolver with this
//     contract's address) lives in `00_setup_resolution.ts` per D-08.
export default deployScript(
  async ({ deploy, execute: write, namedAccounts: { deployer, owner } }) => {
    const riseOwnedResolver = await deploy('RiseOwnedResolver', {
      account: deployer,
      artifact: artifacts.RiseOwnedResolver,
      args: [],
    })

    if (!riseOwnedResolver.newlyDeployed) return

    if (owner && owner !== deployer) {
      console.log(`  - Transferring ownership of RiseOwnedResolver to ${owner}`)
      await write(riseOwnedResolver, {
        functionName: 'transferOwnership',
        args: [owner],
        account: deployer,
      })
    }
  },
  {
    id: 'RiseOwnedResolver v1.0.0',
    tags: ['category:resolver', 'RiseOwnedResolver', 'RiseOwnedResolver:contract'],
    dependencies: [],
  },
)

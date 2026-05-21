import { artifacts, deployScript } from '@rocketh'

// Re-created from reference/ens-contracts/deploy/root/01_deploy_root_security_controller.ts,
// simplified to RNS scope (D-02): the `!use_root` early-return guard is deleted.
// RNSRootSecurityController ownership hands off to `owner` here (D-16: it shares
// the same owner as RNSRoot). With the two-account model (`owner` index 1 !=
// `deployer` index 0) the `owner !== deployer` branch ALWAYS runs locally — it
// is a real handoff, never skipped.
export default deployScript(
  async ({ deploy, get, execute: write, namedAccounts: { deployer, owner } }) => {
    const root = get<(typeof artifacts.RNSRoot)['abi']>('RNSRoot')

    const securityController = await deploy('RNSRootSecurityController', {
      account: deployer,
      artifact: artifacts.RNSRootSecurityController,
      args: [root.address],
    })

    if (!securityController.newlyDeployed) return

    if (owner && owner !== deployer) {
      console.log(
        `  - Transferring ownership of RNSRootSecurityController to ${owner}`,
      )
      await write(securityController, {
        functionName: 'transferOwnership',
        args: [owner],
        account: deployer,
      })
    }
  },
  {
    id: 'RNSRootSecurityController v1.0.0',
    tags: ['category:root', 'RNSRootSecurityController'],
    dependencies: ['RNSRoot:contract'],
  },
)

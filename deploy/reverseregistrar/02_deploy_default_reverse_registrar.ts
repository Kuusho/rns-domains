import { artifacts, deployScript } from '@rocketh'

// Phase 6 — deploy the DefaultReverseRegistrar (zero-arg constructor; OZ v4
// swap done in plan 06-02).
//
// Signing posture: deployer deploys, then transferOwnership(owner). The
// contract inherits RNSControllable → Ownable v4, so OZ Ownable seats the
// deployer as the initial owner.
//
// Dependencies: NONE. DefaultReverseRegistrar is a standalone contract — it
// has no constructor-time reference to RNSRegistry or any other Phase 2-5
// deployment. The controller in 01_deploy_rise_registrar_controller.ts will
// reference both reverse registrars (ReverseRegistrar + DefaultReverseRegistrar)
// via rocketh deployments.
export default deployScript(
  async ({ deploy, execute: write, namedAccounts: { deployer, owner } }) => {
    const defaultReverseRegistrar = await deploy('DefaultReverseRegistrar', {
      account: deployer,
      artifact: artifacts.DefaultReverseRegistrar,
      args: [],
    })

    if (!defaultReverseRegistrar.newlyDeployed) return

    if (owner && owner !== deployer) {
      console.log(
        `  - Transferring ownership of DefaultReverseRegistrar to ${owner}`,
      )
      await write(defaultReverseRegistrar, {
        functionName: 'transferOwnership',
        args: [owner],
        account: deployer,
      })
    }
  },
  {
    id: 'DefaultReverseRegistrar v1.0.0',
    tags: [
      'category:reverseregistrar',
      'DefaultReverseRegistrar',
      'DefaultReverseRegistrar:contract',
    ],
    dependencies: [],
  },
)

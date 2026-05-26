import { artifacts, deployScript } from '@rocketh'

// Phase 6 — deploy the ReverseRegistrar with the RNS registry address.
//
// Signing posture (Phase 4 / Phase 5 D-11): `deployer` deploys (it's a fresh
// deploy, no onlyOwner call is made during construction); then deployer (the
// post-construct OZ Ownable v4 owner) hands ownership to the named `owner`
// account. Same shape as deploy/resolver/00_deploy_public_resolver.ts and
// deploy/registrar-controller/00_deploy_rise_price_oracle.ts.
//
// Dependencies: RNSRegistry — constructor takes rns.address. The dependency
// tag is the bare `'RNSRegistry'` (no `:contract` suffix) because that's the
// tag the Phase 2 registry deploy script emits.
//
// No standalone activation gate in THIS script — the addr.reverse root-handoff
// lives in 01_setup_addr_reverse.ts (deployer-signed, Pitfall 3).
export default deployScript(
  async ({ deploy, execute: write, get, namedAccounts: { deployer, owner } }) => {
    const rns = get<(typeof artifacts.RNSRegistry)['abi']>('RNSRegistry')

    const reverseRegistrar = await deploy('ReverseRegistrar', {
      account: deployer,
      artifact: artifacts.ReverseRegistrar,
      args: [rns.address],
    })

    if (!reverseRegistrar.newlyDeployed) return

    if (owner && owner !== deployer) {
      console.log(`  - Transferring ownership of ReverseRegistrar to ${owner}`)
      await write(reverseRegistrar, {
        functionName: 'transferOwnership',
        args: [owner],
        account: deployer,
      })
    }
  },
  {
    id: 'ReverseRegistrar v1.0.0',
    tags: ['category:reverseregistrar', 'ReverseRegistrar', 'ReverseRegistrar:contract'],
    dependencies: ['RNSRegistry'],
  },
)

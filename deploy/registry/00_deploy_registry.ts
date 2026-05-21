import { artifacts, deployScript } from '@rocketh'

// Re-created from reference/ens-contracts/deploy/registry/00_deploy_registry.ts,
// simplified to RNS scope (D-02 / RESEARCH Pitfall 4):
//   - the ENS migration branch is deleted entirely — RNS is greenfield, there
//     is no fallback registry to migrate from;
//   - the `!use_root` final `setOwner` block is deleted — `use_root` is treated
//     as always-on, and `00_setup_root.ts` performs the root-ownership handoff.
// The RNSRegistry constructor seats the deployer as owner of root node 0x0;
// `00_setup_root.ts` then hands that node to the RNSRoot contract.
export default deployScript(
  async ({ deploy, namedAccounts: { deployer } }) => {
    await deploy('RNSRegistry', {
      account: deployer,
      artifact: artifacts.RNSRegistry,
    })
  },
  {
    id: 'RNSRegistry v1.0.0',
    tags: ['category:registry', 'RNSRegistry'],
  },
)

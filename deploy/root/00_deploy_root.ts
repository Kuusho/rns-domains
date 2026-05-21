import { artifacts, deployScript } from '@rocketh'

// Re-created from reference/ens-contracts/deploy/root/00_deploy_root.ts,
// simplified to RNS scope (D-02): the `!use_root` early-return guard is
// deleted — `use_root` is treated as always-on.
// `dependencies: ['RNSRegistry']` encodes the spec §5 chain — rocketh runs the
// registry script first; `get('RNSRegistry')` reads the deployed artifact.
export default deployScript(
  async ({ deploy, get, namedAccounts: { deployer } }) => {
    const registry =
      get<(typeof artifacts.RNSRegistry)['abi']>('RNSRegistry')

    await deploy('RNSRoot', {
      account: deployer,
      artifact: artifacts.RNSRoot,
      args: [registry.address],
    })
  },
  {
    id: 'RNSRoot:contract v1.0.0',
    tags: ['category:root', 'RNSRoot', 'RNSRoot:contract'],
    dependencies: ['RNSRegistry'],
  },
)

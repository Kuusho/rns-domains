import { artifacts, deployScript } from '@rocketh'
import { namehash } from 'viem'

// Re-created from the reference ethregistrar deploy script for the base registrar
// implementation, simplified to RNS scope (D-02):
//   - the `!use_root` early-return guard is deleted — `use_root` is treated as always-on;
//   - the reference registry artifact name is replaced by the RNS registry name (Phase 2 D-11 naming);
//   - the reference registrar artifact name is replaced by RiseRegistrar (Phase 1 D-10 / Phase 3 D-10);
//   - the reference TLD namehash literal is replaced by namehash for the rise TLD (spec §6.1 — Phase 3 D-02).
// Constructor: RiseRegistrar(RNS _rns, bytes32 _baseNode) — see contracts/riseregistrar/RiseRegistrar.sol.
// Post-condition: RiseRegistrar.owner() == deployer (OZ Ownable seats the deployer);
// transfer to RegistrarSecurityController happens in 00_setup_rise_registrar.ts (D-02 activation gate step 3a).
export default deployScript(
  async ({ deploy, get, namedAccounts: { deployer } }) => {
    const registry = get<(typeof artifacts.RNSRegistry)['abi']>('RNSRegistry')

    await deploy('RiseRegistrar', {
      account: deployer,
      artifact: artifacts.RiseRegistrar,
      args: [registry.address, namehash('rise')],
    })
  },
  {
    id: 'RiseRegistrar:contract v1.0.0',
    tags: ['category:riseregistrar', 'RiseRegistrar', 'RiseRegistrar:contract'],
    dependencies: ['RNSRegistry'],
  },
)

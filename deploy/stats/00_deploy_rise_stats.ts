import { artifacts, deployScript } from '@rocketh'

// Phase 8 (v1.1) — deploy RiseStats, the read-only global-counter aggregator
// (ENUM-02 / D-05). Purely additive, no Ownable surface, no activation gate, no
// edits to existing scripts. Source addresses constructor-injected (fork posture).
//
// Constructor: RiseStats(IRegistrarCounters _registrar, ISubdomainCounter
//   _subdomainRegistrar, IControllerVolume _controller)
//   - _registrar          — RiseRegistrar (registrations/renewals/totalSupply)
//   - _subdomainRegistrar  — SubdomainRegistrar (totalSubdomains)
//   - _controller          — RiseRegistrarController (cumulativeVolume)
//
// Depends on the Phase-8-modified RiseRegistrar (v1.1.0 id) + SubdomainRegistrar +
// the redeployed RiseRegistrarController (v1.1.0 id). Dependency-tag asymmetry:
// bare 'RNSRegistry' is not needed (we don't read the registry); we depend on the
// three counter contracts' ':contract' tags.
//
// No ownership handoff: RiseStats has no Ownable surface (pure read aggregator).
export default deployScript(
  async ({ deploy, get, namedAccounts: { deployer } }) => {
    const registrar = get<(typeof artifacts.RiseRegistrar)['abi']>('RiseRegistrar')
    const subdomainRegistrar = get<(typeof artifacts.SubdomainRegistrar)['abi']>('SubdomainRegistrar')
    const controller = get<(typeof artifacts.RiseRegistrarController)['abi']>('RiseRegistrarController')

    await deploy('RiseStats', {
      account: deployer,
      artifact: artifacts.RiseStats,
      args: [registrar.address, subdomainRegistrar.address, controller.address],
    })
  },
  {
    id: 'RiseStats v1.0.0',
    tags: ['category:stats', 'RiseStats', 'RiseStats:contract'],
    dependencies: [
      'RiseRegistrar:contract',
      'SubdomainRegistrar:contract',
      'RiseRegistrarController:contract',
    ],
  },
)

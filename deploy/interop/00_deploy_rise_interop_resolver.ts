import { artifacts, deployScript } from '@rocketh'

// Phase 8 (v1.1) — deploy RiseInteropResolver, the standalone ERC-7930 interop
// view (INTEROP-01 / D-09). Purely additive, read-only; no activation gate, no
// edits to existing scripts. Mirrors deploy/subdomain/00_deploy_subdomain_registrar.ts.
//
// Constructor: RiseInteropResolver(RNS _rns, uint256 _chainId)
//   - _rns      — Phase 2 RNSRegistry (resolver lookup source)
//   - _chainId  — RiseChain testnet 11155931 (D-10 — constructor-injected, NEVER
//                 hardcoded in the contract; supplied here at deploy time).
//
// Dependency-tag asymmetry (verified Phase 7): Phase 2 emits the BARE tag
// 'RNSRegistry'. The interop view has no ownable surface, so NO ownership handoff.
const RISE_CHAIN_ID = 11155931n

export default deployScript(
  async ({ deploy, get, namedAccounts: { deployer } }) => {
    const rns = get<(typeof artifacts.RNSRegistry)['abi']>('RNSRegistry')

    await deploy('RiseInteropResolver', {
      account: deployer,
      artifact: artifacts.RiseInteropResolver,
      args: [rns.address, RISE_CHAIN_ID],
    })
  },
  {
    id: 'RiseInteropResolver v1.0.0',
    tags: ['category:interop', 'RiseInteropResolver', 'RiseInteropResolver:contract'],
    dependencies: ['RNSRegistry'],
  },
)

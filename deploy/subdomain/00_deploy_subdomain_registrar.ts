import { artifacts, deployScript } from '@rocketh'

// Phase 7 (v1.1) — deploy the SubdomainRegistrar, the one net-new, purely-additive
// subdomain-marketplace contract. Mirrors deploy/resolver/00_deploy_public_resolver.ts
// shape EXACTLY (deploy/get/write, newlyDeployed guard, ownership-handoff branch,
// the { id, tags, dependencies } block) and the multi-dep precedent of
// deploy/registrar-controller/01_deploy_rise_registrar_controller.ts.
//
// Constructor (Plan 07-01 LOCKED order):
//   SubdomainRegistrar(RNS _rns, RiseRegistrar _registrar, address _defaultResolver,
//                      address _feeRecipient, uint256 _feeBps)
//   - _rns             — Phase 2 RNSRegistry (subnode write path + operator-approval auth)
//   - _registrar       — Phase 3 RiseRegistrar (observable parent state only; epoch derivation)
//   - _defaultResolver — Phase 4 PublicResolver (written onto sold subnodes, A3)
//   - _feeRecipient    — protocol fee sink (== owner here; could be distinct)
//   - _feeBps          — default protocol fee 0 (D-08). FEE_CAP_BPS is a CONTRACT
//                        CONSTANT, NOT a constructor arg (D-07/D-08).
//
// NO activation-gate setup script: parents self-onboard via setApprovalForAll +
// configure; nothing must grant the registrar a role (RESEARCH Runtime State
// Inventory). NO edits to any existing deploy script.
//
// Dependency-tag asymmetry (Open Q3 — VERIFIED this session by reading each dep
// script): Phase 2's deploy/registry/00_deploy_registry.ts emits the BARE tag
// 'RNSRegistry' (no ':contract' variant), while deploy/riseregistrar/00_deploy_rise_registrar.ts
// and deploy/resolver/00_deploy_public_resolver.ts both emit ':contract' variants.
// => dependencies: ['RNSRegistry', 'RiseRegistrar:contract', 'PublicResolver:contract'].
//
// Ownership handoff: OZ Ownable v4.9.3 seats `deployer`; the two-account model
// (D-14 — `owner` is Hardhat index 1, distinct from `deployer` index 0) means the
// `if (owner && owner !== deployer)` branch ALWAYS runs locally. Post-condition:
// SubdomainRegistrar.owner() == the named `owner`.
export default deployScript(
  async ({ deploy, get, execute: write, namedAccounts: { deployer, owner } }) => {
    const rns = get<(typeof artifacts.RNSRegistry)['abi']>('RNSRegistry')
    const registrar = get<(typeof artifacts.RiseRegistrar)['abi']>('RiseRegistrar')
    const resolver = get<(typeof artifacts.PublicResolver)['abi']>('PublicResolver')

    const sub = await deploy('SubdomainRegistrar', {
      account: deployer,
      artifact: artifacts.SubdomainRegistrar,
      args: [
        rns.address, // RNS registry (Phase 2)
        registrar.address, // RiseRegistrar (Phase 3) — observable parent state only
        resolver.address, // default resolver on sold subnodes (Phase 4 PublicResolver, A3)
        owner, // protocol fee recipient (== owner here; could be distinct)
        0n, // default feeBps (D-08: 0%); FEE_CAP_BPS is a CONTRACT CONSTANT, NOT a ctor arg
      ],
    })

    if (!sub.newlyDeployed) return

    if (owner && owner !== deployer) {
      console.log(`  - Transferring ownership of SubdomainRegistrar to ${owner}`)
      await write(sub, { functionName: 'transferOwnership', args: [owner], account: deployer })
    }
  },
  {
    id: 'SubdomainRegistrar v1.0.0',
    tags: ['category:subdomain', 'SubdomainRegistrar', 'SubdomainRegistrar:contract'],
    dependencies: ['RNSRegistry', 'RiseRegistrar:contract', 'PublicResolver:contract'],
  },
)

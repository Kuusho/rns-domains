import { artifacts, deployScript } from '@rocketh'
import { keccak256, toBytes } from 'viem'

// Phase 6 — deploy the RiseRegistrarController (the big one, ~487 LOC port +
// RNS additions per plan 06-03).
//
// Constructor args (7-arg shape — RESEARCH Focus 1 keeps all 7; thinning breaks
// REG-04 because rns.setRecord is required for the resolver-multicall path):
//   1. RiseRegistrar         — the ERC-721 the controller mints names through
//   2. IPriceOracle          — RiseDurationPriceOracle (Phase 8 — repointed from
//                              RisePriceOracle per RF-1; prices is immutable, so
//                              switching the discount oracle forces a redeploy)
//   3. minCommitmentAge      — 60 (seconds; D-01)
//   4. maxCommitmentAge      — 86400 (24h; D-01)
//   5. IReverseRegistrar     — ReverseRegistrar (06-01)
//   6. IDefaultReverseRegistrar — DefaultReverseRegistrar (06-02)
//   7. RNS                   — RNSRegistry (Phase 2)
//
// Signing posture: deployer deploys → deployer seeds 24 reserved labels via
// setReserved (BEFORE transferOwnership; deployer is the post-construct OZ
// Ownable owner) → transferOwnership(owner). REG-09/REG-10 closure happens
// INSIDE this script via the seed loop; the seed list is the D-03 + Focus 4
// 24-label set.
//
// The activation gate (controller registered as controller=true on registrar
// SC + both reverse registrars — REG-13) lives in 02_setup_registration.ts,
// which signs with `owner` (Pitfall 2).
//
// Tag note: `RNSRegistry` dependency uses the bare tag (no `:contract`
// suffix) because that's the tag Phase 2's deploy/registry/00_deploy_registry.ts
// actually emits.
const RESERVED_LABELS = [
  // CONTEXT D-03 confirmed seed (20 labels):
  'rise',
  'rns',
  'risechain',
  'ens',
  'admin',
  'system',
  'team',
  'r2',
  'pantelai',
  'mvp',
  'dao',
  'root',
  'controller',
  'oracle',
  'registry',
  'resolver',
  'registrar',
  'reverse',
  'governance',
  'treasury',
  // RESEARCH Focus 4 additions (4 labels):
  'mainnet',
  'testnet',
  'null',
  'void',
] as const

export default deployScript(
  async ({
    deploy,
    execute: write,
    get,
    namedAccounts: { deployer, owner },
  }) => {
    // Read all 6 cross-phase contract addresses.
    const registrar = get<(typeof artifacts.RiseRegistrar)['abi']>(
      'RiseRegistrar',
    )
    // RF-1 (Phase 8 / Plan 08-03) — the controller's `prices` arg now points at
    // the RiseDurationPriceOracle (tiered multi-year discount). prices is
    // `immutable` with no setter, so repointing it forces this controller
    // redeploy (id bumped to v1.1.0 below).
    const priceOracle = get<(typeof artifacts.RiseDurationPriceOracle)['abi']>(
      'RiseDurationPriceOracle',
    )
    const reverseRegistrar = get<
      (typeof artifacts.ReverseRegistrar)['abi']
    >('ReverseRegistrar')
    const defaultReverseRegistrar = get<
      (typeof artifacts.DefaultReverseRegistrar)['abi']
    >('DefaultReverseRegistrar')
    const rns = get<(typeof artifacts.RNSRegistry)['abi']>('RNSRegistry')

    const controller = await deploy('RiseRegistrarController', {
      account: deployer,
      artifact: artifacts.RiseRegistrarController,
      args: [
        registrar.address,
        priceOracle.address,
        60n, // minCommitmentAge — D-01
        86400n, // maxCommitmentAge — D-01 (24h)
        reverseRegistrar.address,
        defaultReverseRegistrar.address,
        rns.address,
      ],
    })

    if (!controller.newlyDeployed) return

    // Seed the 24 reserved labels BEFORE transferOwnership (deployer is still
    // the OZ Ownable owner here; transferOwnership runs next). Once ownership
    // moves, only `owner` can call setReserved; pre-seeding while the deployer
    // is owner is the canonical deploy-time shortcut.
    console.log(
      `  - Seeding ${RESERVED_LABELS.length} reserved labels on RiseRegistrarController`,
    )
    for (const label of RESERVED_LABELS) {
      const labelHash = keccak256(toBytes(label))
      await write(controller, {
        functionName: 'setReserved',
        args: [labelHash, true],
        account: deployer,
      })
    }

    if (owner && owner !== deployer) {
      console.log(
        `  - Transferring ownership of RiseRegistrarController to ${owner}`,
      )
      await write(controller, {
        functionName: 'transferOwnership',
        args: [owner],
        account: deployer,
      })
    }
  },
  {
    // id bumped to v1.1.0 — Phase 8: cumulativeVolume counter + 1-10yr cap +
    // prices repointed at RiseDurationPriceOracle (RF-1: prices is immutable,
    // redeploy forced).
    id: 'RiseRegistrarController v1.1.0',
    tags: [
      'category:registrar-controller',
      'RiseRegistrarController',
      'RiseRegistrarController:contract',
    ],
    dependencies: [
      'RiseRegistrar:contract',
      'RegistrarSecurityController:contract',
      // Controller now consumes the duration oracle (the discount source) —
      // RisePriceOracle is no longer a controller dependency.
      'RiseDurationPriceOracle:contract',
      'ReverseRegistrar:contract',
      'DefaultReverseRegistrar:contract',
      'RNSRegistry',
    ],
  },
)

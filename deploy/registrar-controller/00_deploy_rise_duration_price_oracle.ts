import { artifacts, deployScript } from '@rocketh'

// Phase 8 (Plan 08-03) — deploy the RiseDurationPriceOracle: the same flat
// per-length wei/sec schedule as RisePriceOracle (so base prices are UNCHANGED)
// plus an owner-tunable duration-tier discount (MYR-02 / D-07 / D-08).
//
// RF-1 (the plan-shaping finding): RiseRegistrarController.prices is `immutable`
// with NO setter, so the discount oracle cannot be hot-swapped into the existing
// controller. This new oracle is deployed, then 01_deploy_rise_registrar_controller.ts
// repoints the controller's `prices` constructor arg at it (forcing a controller
// redeploy — see that script's id bump to v1.1.0).
//
// Seeds are IDENTICAL to RisePriceOracle's INITIAL_RENT_PRICES (duplicate-locked
// here so the 28-day base path and the 1-year price stay byte-identical to the
// flat oracle — only multi-year durations attract the new discount). The default
// discount schedule (1yr 0% / 2-3yr 5% / 4-5yr 10% / 6-9yr 15% / 10yr 20%) lives
// in the contract constructor; tune post-deploy via setDiscounts up to the
// immutable MAX_DISCOUNT_BPS = 2000 cap.
//
// Signing posture (D-11, mirrors 00_deploy_rise_price_oracle.ts): `deployer`
// deploys (no onlyOwner call during construction), then hands ownership to the
// named `owner` account via transferOwnership.
//
// Dependencies: NONE — like the flat oracle, this reads no other RNS contract.
const INITIAL_RENT_PRICES = [
  500_000_000n,   // [0] 1-char rate (10x base — D-02 specifics)
  500_000_000n,   // [1] 2-char rate (10x base — D-02 specifics)
  100_000_000n,   // [2] 3-char rate (graduated descent)
  75_000_000n,    // [3] 4-char rate (graduated descent)
  50_000_000n,    // [4] 5+-char rate (~$5/year @ $3000 native — baseline)
] as const

export default deployScript(
  async ({ deploy, execute: write, namedAccounts: { deployer, owner } }) => {
    const durationOracle = await deploy('RiseDurationPriceOracle', {
      account: deployer,
      artifact: artifacts.RiseDurationPriceOracle,
      args: [INITIAL_RENT_PRICES as unknown as readonly bigint[]],
    })

    if (!durationOracle.newlyDeployed) return

    if (owner && owner !== deployer) {
      console.log(
        `  - Transferring ownership of RiseDurationPriceOracle to ${owner}`,
      )
      await write(durationOracle, {
        functionName: 'transferOwnership',
        args: [owner],
        account: deployer,
      })
    }
  },
  {
    id: 'RiseDurationPriceOracle v1.0.0',
    tags: [
      'category:registrar-controller',
      'RiseDurationPriceOracle',
      'RiseDurationPriceOracle:contract',
    ],
    dependencies: [],
  },
)

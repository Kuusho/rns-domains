import { artifacts, deployScript } from '@rocketh'

// Phase 5 — deploy the RisePriceOracle with a concrete per-length wei/sec schedule.
// Signing posture (D-11): `deployer` deploys (it's a fresh deploy, no onlyOwner call
// is made during construction), then `deployer` (the post-construct Ownable owner per
// OZ v4) hands ownership to the named `owner` account. Same pattern as
// deploy/resolver/00_deploy_public_resolver.ts and 00_deploy_rise_owned_resolver.ts.
//
// Dependencies: NONE. RisePriceOracle reads no other RNS contract — it's a pure
// schedule reader. Phase 5's depends-on relationship to Phase 3 in the ROADMAP
// (Phase 5 depends on Phase 3) is about scheduling — registrar contracts exist by
// the time the oracle ships — NOT about the oracle reading them. The rocketh
// dependency array stays empty so the oracle can deploy independently of any prior
// setup gate. Phase 6's RiseRegistrarController will declare the oracle as one of
// its own dependencies.
//
// Seeded per-length schedule (wei/sec) — Plan 05-03 Specifics, all tunable post-deploy
// via setRentPrices (PRICE-04). Per-year math at $3000/native USD reference:
//
//   index | length | wei/sec        | wei/year (* 31_536_000)        | ~USD/year @ $3000
//   ------+--------+----------------+---------------------------------+------------------
//   [0]   | 1 char | 500_000_000    | 1.5768e16   (0.015768 native)  | ~$47.30   <- 10x per D-02
//   [1]   | 2 char | 500_000_000    | 1.5768e16   (0.015768 native)  | ~$47.30   <- 10x per D-02
//   [2]   | 3 char | 100_000_000    | 3.1536e15   (0.003154 native)  | ~$9.46
//   [3]   | 4 char | 75_000_000     | 2.3652e15   (0.002365 native)  | ~$7.10
//   [4]   | 5+char | 50_000_000     | 1.5768e15   (0.001577 native)  | ~$4.73    <- ~$5/year target per CONTEXT Specifics
//
// NO USD MATH AT RUNTIME — values are concrete BigInt wei/sec; the dollar comments
// are derivation hints for human reviewers ONLY (PRICE-03 — no external price-feed
// dependency, no on-chain conversion).
//
// No standalone activation gate (D-11 last bullet) — there is no controller list to
// register the oracle in; Phase 6's RiseRegistrarController will take the oracle's
// address directly as a constructor argument.
const INITIAL_RENT_PRICES = [
  500_000_000n,   // [0] 1-char rate (10x base — D-02 specifics)
  500_000_000n,   // [1] 2-char rate (10x base — D-02 specifics)
  100_000_000n,   // [2] 3-char rate (graduated descent)
  75_000_000n,    // [3] 4-char rate (graduated descent)
  50_000_000n,    // [4] 5+-char rate (~$5/year @ $3000 native — Claude's Discretion baseline)
] as const

export default deployScript(
  async ({ deploy, execute: write, namedAccounts: { deployer, owner } }) => {
    const riseOracle = await deploy('RisePriceOracle', {
      account: deployer,
      artifact: artifacts.RisePriceOracle,
      args: [INITIAL_RENT_PRICES as unknown as readonly bigint[]],
    })

    if (!riseOracle.newlyDeployed) return

    if (owner && owner !== deployer) {
      console.log(`  - Transferring ownership of RisePriceOracle to ${owner}`)
      await write(riseOracle, {
        functionName: 'transferOwnership',
        args: [owner],
        account: deployer,
      })
    }
  },
  {
    id: 'RisePriceOracle v1.0.0',
    tags: [
      'category:registrar-controller',
      'RisePriceOracle',
      'RisePriceOracle:contract',
    ],
    dependencies: [],
  },
)

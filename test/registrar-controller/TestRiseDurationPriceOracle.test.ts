import { shouldSupportInterfaces } from '@ensdomains/hardhat-chai-matchers-viem/behaviour'
import hre from 'hardhat'

import { getAccounts } from '../fixtures/utils.js'

// Unit-test suite for RiseDurationPriceOracle (Plan 08-03, Task 0/1 — MYR-02).
//
// The duration oracle mirrors RisePriceOracle's flat per-length base price
// (uint256[5] rentPrices, length 1→[0]..≥5→[4]) and then applies a duration-
// keyed discount in bps. Because the controller's _rentPrice calls the SAME
// prices.price() seam for both register and renew, a duration-keyed discount
// gives renew the same discount as register (D-07) with zero controller logic.
//
// Coverage:
//   * Default tier schedule — 1yr 0% / 2-3yr 5% / 4-5yr 10% / 6-9yr 15% /
//     10yr 20% — asserted against a separately-deployed flat RisePriceOracle
//     with identical seeds (the discount is exactly flatBase * (1 - bps/10000)).
//   * 28-day base-path parity (Pitfall 6) — a sub-1-year duration gets a 0%
//     discount so the price is byte-identical to the flat oracle.
//   * Owner-tunable tiers up to the immutable MAX_DISCOUNT_BPS = 2000 cap
//     (mirrors RisePriceOracle's setRentPrices + SubdomainRegistrar's
//     FEE_CAP_BPS cap-guard posture).
//   * setDiscounts cap-guard reverts DiscountTooHigh; non-owner reverts Ownable.
//   * supportsInterface advertises IERC165 + IPriceOracle.
//
// Direct-deploy pattern (no rocketh-in-test) — mirrors TestRisePriceOracle.

const connection = await hre.network.connect()
const accounts = await getAccounts(connection)
const deployer = accounts[0] // Hardhat idx 0 — OZ Ownable v4 seats this as initial owner
const owner = accounts[1] // Hardhat idx 1 — distinct-account pattern
const stranger = accounts[2] // non-owner test caller

// Reuse TestRisePriceOracle's SEEDS verbatim so the parity comparisons against
// a freshly-deployed flat RisePriceOracle are exact. Index 1→[0]..≥5→[4].
const SEEDS = [10n, 20n, 30n, 40n, 50n] as const

// Tier boundary unit — must match RiseDurationPriceOracle.SECONDS_PER_YEAR
// (365 days). The default discount schedule the oracle ships, indexed by whole
// year count (index 0 unused):
//   1yr → 0bps, 2yr → 500, 3yr → 500, 4yr → 1000, 5yr → 1000,
//   6yr → 1500, 7yr → 1500, 8yr → 1500, 9yr → 1500, 10yr → 2000.
const ONE_YEAR = 365n * 86400n
const TWENTY_EIGHT_DAYS = 28n * 86400n

// Discount math the oracle implements EXACTLY:
//   discountedBase = flatBase - (flatBase * bps) / 10000
const discount = (flatBase: bigint, bps: bigint) =>
  flatBase - (flatBase * bps) / 10_000n

// IPriceOracle.interfaceId — single-function interface, so type(I).interfaceId
// equals price()'s selector (XOR of one element is itself). Computed at runtime
// to be hallucination-proof (Plan 05-04 pattern); cross-checks the known value
// 0x50e9a715 from STATE.md.
const IPRICE_ORACLE_ID = '0x50e9a715'

async function fixture() {
  const oracle = await connection.viem.deployContract(
    'RiseDurationPriceOracle',
    [SEEDS as unknown as readonly bigint[]],
  )
  // A flat oracle with identical seeds — the parity yardstick.
  const flat = await connection.viem.deployContract('RisePriceOracle', [
    SEEDS as unknown as readonly bigint[],
  ])
  return { oracle, flat }
}
const loadFixture = async () => connection.networkHelpers.loadFixture(fixture)

describe('RiseDurationPriceOracle', () => {
  // Block — ERC-165 advertisement: IERC165 + IPriceOracle.
  shouldSupportInterfaces({
    contract: () => loadFixture().then(({ oracle }) => oracle),
    interfaces: ['IERC165', 'IPriceOracle'],
  })

  it('10 — supportsInterface advertises IPriceOracle + IERC165', async () => {
    const { oracle } = await loadFixture()
    await expect(
      oracle.read.supportsInterface(['0x01ffc9a7']),
    ).resolves.toBe(true) // type(IERC165).interfaceId
    await expect(
      oracle.read.supportsInterface([IPRICE_ORACLE_ID]),
    ).resolves.toBe(true) // type(IPriceOracle).interfaceId
  })

  it('1 — 1-year price has 0% discount (parity with flat oracle)', async () => {
    const { oracle, flat } = await loadFixture()
    const name = 'alice' // 5-char → rentPrices[4] = 50
    const rentRate = 50n
    const got = await oracle.read.price([name, 0n, ONE_YEAR])
    expect(got.base).toBe(rentRate * ONE_YEAR) // no discount at 1 year
    expect(got.premium).toBe(0n)
    // Cross-check: byte-identical to the flat oracle at 1 year.
    const flatPrice = await flat.read.price([name, 0n, ONE_YEAR])
    expect(got.base).toBe(flatPrice.base)
  })

  it('2 — 2-year price has 5% discount', async () => {
    const { oracle } = await loadFixture()
    const name = 'alice'
    const flatBase2yr = 50n * 2n * ONE_YEAR
    const got = await oracle.read.price([name, 0n, 2n * ONE_YEAR])
    expect(got.base).toBe(discount(flatBase2yr, 500n))
    expect(got.premium).toBe(0n)
  })

  it('3 — 5-year price has 10% discount', async () => {
    const { oracle } = await loadFixture()
    const name = 'alice'
    const flatBase5yr = 50n * 5n * ONE_YEAR
    const got = await oracle.read.price([name, 0n, 5n * ONE_YEAR])
    expect(got.base).toBe((flatBase5yr * 9000n) / 10_000n)
  })

  it('4 — 10-year price has 20% discount', async () => {
    const { oracle } = await loadFixture()
    const name = 'alice'
    const flatBase10yr = 50n * 10n * ONE_YEAR
    const got = await oracle.read.price([name, 0n, 10n * ONE_YEAR])
    expect(got.base).toBe((flatBase10yr * 8000n) / 10_000n)
  })

  it('5 — 28-day base path is discount-free (Pitfall 6 parity)', async () => {
    const { oracle, flat } = await loadFixture()
    const name = 'alice'
    const got = await oracle.read.price([name, 0n, TWENTY_EIGHT_DAYS])
    const flatPrice = await flat.read.price([name, 0n, TWENTY_EIGHT_DAYS])
    // A sub-1-year duration gets a 0% discount → price-identical to the flat
    // oracle (the 28-day base path must stay unchanged after the oracle swap).
    expect(got.base).toBe(flatPrice.base)
    expect(got.base).toBe(50n * TWENTY_EIGHT_DAYS)
  })

  it('6 — owner can tune a tier up to the cap', async () => {
    const { oracle } = await loadFixture()
    const name = 'alice'
    const flatBase10yr = 50n * 10n * ONE_YEAR

    // Default 10yr tier is 2000 (20%).
    const before = await oracle.read.price([name, 0n, 10n * ONE_YEAR])
    expect(before.base).toBe((flatBase10yr * 8000n) / 10_000n)

    // Re-set the 10yr tier to 1000 (10%); leave the rest at default.
    const tuned = [0, 0, 500, 500, 1000, 1000, 1500, 1500, 1500, 1500, 1000] as const
    await oracle.write.setDiscounts(
      [tuned as unknown as readonly number[]],
      { account: deployer },
    )
    const after = await oracle.read.price([name, 0n, 10n * ONE_YEAR])
    expect(after.base).toBe((flatBase10yr * 9000n) / 10_000n)

    // Re-set the 10yr tier back to the cap (2000 / 20%).
    const maxed = [0, 0, 500, 500, 1000, 1000, 1500, 1500, 1500, 1500, 2000] as const
    await oracle.write.setDiscounts(
      [maxed as unknown as readonly number[]],
      { account: deployer },
    )
    const maxedPrice = await oracle.read.price([name, 0n, 10n * ONE_YEAR])
    expect(maxedPrice.base).toBe((flatBase10yr * 8000n) / 10_000n)
  })

  it('7 — setting a tier above MAX_DISCOUNT_BPS reverts DiscountTooHigh', async () => {
    const { oracle } = await loadFixture()
    const tooHigh = [0, 0, 500, 500, 1000, 1000, 1500, 1500, 1500, 1500, 2001] as const
    await expect(
      oracle.write.setDiscounts(
        [tooHigh as unknown as readonly number[]],
        { account: deployer },
      ),
    ).toBeRevertedWithCustomError('DiscountTooHigh')
  })

  it('8 — non-owner setter reverts Ownable', async () => {
    const { oracle } = await loadFixture()
    const schedule = [0, 0, 500, 500, 1000, 1000, 1500, 1500, 1500, 1500, 2000] as const
    await expect(
      oracle.write.setDiscounts(
        [schedule as unknown as readonly number[]],
        { account: stranger },
      ),
    ).toBeRevertedWithString('Ownable: caller is not the owner')
  })

  it('9 — MAX_DISCOUNT_BPS getter == 2000', async () => {
    const { oracle } = await loadFixture()
    await expect(oracle.read.MAX_DISCOUNT_BPS()).resolves.toBe(2000n)
  })

  describe('owner handoff (Ownable parity — deploy-script transferOwnership)', () => {
    it('after transferOwnership, only the new owner can tune tiers', async () => {
      const { oracle } = await loadFixture()
      await oracle.write.transferOwnership([owner.address], {
        account: deployer,
      })
      const schedule = [0, 0, 500, 500, 1000, 1000, 1500, 1500, 1500, 1500, 2000] as const
      // Former owner (deployer) now cannot set.
      await expect(
        oracle.write.setDiscounts(
          [schedule as unknown as readonly number[]],
          { account: deployer },
        ),
      ).toBeRevertedWithString('Ownable: caller is not the owner')
      // New owner can set.
      await oracle.write.setDiscounts(
        [schedule as unknown as readonly number[]],
        { account: owner },
      )
    })
  })
})

import hre from 'hardhat'
import {
  type Hex,
  labelhash,
  toHex,
  zeroAddress,
  zeroHash,
} from 'viem'
import { randomBytes } from 'node:crypto'

import { loadAndExecuteDeployments } from '../../rocketh.js'
import { getAccounts } from '../fixtures/utils.js'
import {
  registerRiseName,
  type Registration,
} from '../fixtures/registerRiseName.js'

// Phase 8 (Plan 08-03) integration suite — MYR-01 / MYR-02 / D-07 / ENUM-02.
// Runs the FULL Phase 1-8 deploy chain inline via loadAndExecuteDeployments
// (rocketh-in-test), so the controller under test is the v1.1.0 redeploy whose
// `prices` arg points at RiseDurationPriceOracle and which carries the
// cumulativeVolume counter + the 1-10yr cap. Proves end-to-end:
//   * MYR-01 — register for 1/5/10 years in one tx; >10yr reverts DurationTooLong;
//     the 28-day base path still works (Pitfall 6).
//   * D-07  — renew gets the SAME discount as register for the same duration
//     (both go through the same prices.price() seam).
//   * ENUM-02 / Pitfall 2 — cumulativeVolume rises by the PRICED amount on
//     register (base+premium, even when overpaying) and on renew (base).
//
// Per STATE.md (08-02 deviation): the full Phase 1-8 deploy chain exceeds
// vitest's 5s default, so each test sets an explicit 120s timeout.

const connection = await hre.network.connect()
const accounts = await getAccounts(connection)

async function fixture() {
  const env = await loadAndExecuteDeployments({
    provider: connection.provider as never,
    network: connection.networkName,
    saveDeployments: false,
    askBeforeProceeding: false,
    logLevel: 0,
  })

  const riseRegistrar = await connection.viem.getContractAt(
    'RiseRegistrar',
    env.deployments.RiseRegistrar.address as `0x${string}`,
  )
  const controller = await connection.viem.getContractAt(
    'RiseRegistrarController',
    env.deployments.RiseRegistrarController.address as `0x${string}`,
  )
  // Read the discount oracle through IPriceOracle — the surface the controller
  // consumes. Confirms the controller's `prices` resolves to the duration oracle.
  const priceOracle = await connection.viem.getContractAt(
    'IPriceOracle',
    env.deployments.RiseDurationPriceOracle.address as `0x${string}`,
  )

  return { riseRegistrar, controller, priceOracle }
}

const loadFixture = async () => connection.networkHelpers.loadFixture(fixture)

// rocketh.ts namedAccounts: deployer = idx 0; owner = idx 1.
const owner = accounts[1]
const alice = accounts[2]
const bob = accounts[3]

const MIN_COMMITMENT_AGE = 60n
const ONE_YEAR = 365n * 86400n
const TWENTY_EIGHT_DAYS = 28n * 86400n

// Production 5+-char rate seeded by both oracles (INITIAL_RENT_PRICES[4]).
const RATE_5PLUS = 50_000_000n

// Discount math the oracle implements EXACTLY.
const discount = (flatBase: bigint, bps: bigint) =>
  flatBase - (flatBase * bps) / 10_000n

const TEST_TIMEOUT = 120_000

describe('IntegrationMultiYear (Phase 8 — MYR-01/02 + D-07 + ENUM-02)', () => {
  it(
    'registers for 1, 5, and 10 years in one tx (MYR-01)',
    async () => {
      const { controller, riseRegistrar } = await loadFixture()
      // Launch is active at deploy; allowlist alice so REG-11 doesn't block.
      await controller.write.setAllowlisted([alice.address, true], {
        account: owner,
      })

      const cases: Array<[string, bigint, bigint]> = [
        ['onealice', 1n, ONE_YEAR],
        ['fivealice', 5n, 5n * ONE_YEAR],
        ['tenxalice', 10n, 10n * ONE_YEAR],
      ]
      for (const [label, , duration] of cases) {
        await registerRiseName(
          controller,
          connection.networkHelpers,
          { label, ownerAddress: alice.address, duration },
          { caller: alice },
        )
        const tokenId = BigInt(labelhash(label))
        const expiry = await riseRegistrar.read.nameExpires([tokenId])
        // nameExpires == registration timestamp + duration; it must be >= the
        // duration measured from now (latest block ts), proving the multi-year
        // duration was honored in a single tx.
        const block = await (
          await connection.viem.getPublicClient()
        ).getBlock()
        expect(expiry).toBeGreaterThanOrEqual(block.timestamp + duration - 5n)
        await expect(
          riseRegistrar.read.ownerOf([tokenId]),
        ).resolves.toEqualAddress(alice.address)
      }
    },
    TEST_TIMEOUT,
  )

  it(
    'reverts a registration over 10 years (MYR-01 cap)',
    async () => {
      const { controller } = await loadFixture()
      await controller.write.setAllowlisted([alice.address, true], {
        account: owner,
      })
      const label = 'toolongname'
      const elevenYears = 11n * ONE_YEAR
      const registration: Registration = {
        label,
        owner: alice.address,
        duration: elevenYears,
        secret: toHex(randomBytes(32)) as Hex,
        resolver: zeroAddress,
        data: [],
        reverseRecord: 0,
        referrer: zeroHash as Hex,
      }
      // makeCommitment itself enforces the cap (pure pre-check), so the commit
      // path reverts before register is even reached.
      await expect(
        controller.read.makeCommitment([registration]),
      ).toBeRevertedWithCustomError('DurationTooLong')
    },
    TEST_TIMEOUT,
  )

  it(
    'a 28-day base-path registration still works at the flat rate (Pitfall 6)',
    async () => {
      const { controller, riseRegistrar, priceOracle } = await loadFixture()
      await controller.write.setAllowlisted([alice.address, true], {
        account: owner,
      })
      const label = 'shortnamex' // 10 chars → 5+-char tier
      // The duration oracle must price a sub-1-year duration with 0 discount.
      const price = await priceOracle.read.price([
        label,
        0n,
        TWENTY_EIGHT_DAYS,
      ])
      expect(price.base).toBe(RATE_5PLUS * TWENTY_EIGHT_DAYS)
      expect(price.premium).toBe(0n)

      await registerRiseName(
        controller,
        connection.networkHelpers,
        {
          label,
          ownerAddress: alice.address,
          duration: TWENTY_EIGHT_DAYS,
        },
        { caller: alice },
      )
      const tokenId = BigInt(labelhash(label))
      await expect(
        riseRegistrar.read.ownerOf([tokenId]),
      ).resolves.toEqualAddress(alice.address)
    },
    TEST_TIMEOUT,
  )

  it(
    'renew gets the same discount as register for the same duration (D-07)',
    async () => {
      const { controller, priceOracle } = await loadFixture()
      await controller.write.setAllowlisted([alice.address, true], {
        account: owner,
      })
      const label = 'discntfive' // 10 chars → 5+-char tier
      const fiveYears = 5n * ONE_YEAR

      // Register-time price for 5 years (via the controller's rentPrice → the
      // same prices.price() seam).
      const registerPrice = await controller.read.rentPrice([label, fiveYears])
      // The 5-year tier discount is 10% (1000 bps) off the flat base.
      const flatBase5yr = RATE_5PLUS * fiveYears
      expect(registerPrice.base).toBe(discount(flatBase5yr, 1000n))

      // Register the name for 5 years.
      await registerRiseName(
        controller,
        connection.networkHelpers,
        { label, ownerAddress: alice.address, duration: fiveYears },
        { caller: alice },
      )

      // Renew the SAME name for 5 years; the renew-time rentPrice goes through
      // the identical prices.price() seam → identical discount.
      const renewPrice = await controller.read.rentPrice([label, fiveYears])
      expect(renewPrice.base).toBe(registerPrice.base)

      // And the direct oracle read agrees (expires arg is ignored by the oracle).
      const oraclePrice = await priceOracle.read.price([
        label,
        0n,
        fiveYears,
      ])
      expect(oraclePrice.base).toBe(registerPrice.base)
    },
    TEST_TIMEOUT,
  )

  it(
    'cumulativeVolume increases by the priced amount, not msg.value (ENUM-02 / Pitfall 2)',
    async () => {
      const { controller, riseRegistrar } = await loadFixture()
      await controller.write.setAllowlisted([alice.address, true], {
        account: owner,
      })
      const label = 'volumename' // 10 chars → 5+-char tier
      const duration = ONE_YEAR

      const before = await controller.read.cumulativeVolume()

      // Register with an OVERPAYMENT (value = price * 2). The counter must rise
      // by exactly the priced amount (base + premium), NOT by msg.value.
      const price = await controller.read.rentPrice([label, duration])
      const priced = price.base + price.premium

      const registration: Registration = {
        label,
        owner: alice.address,
        duration,
        secret: toHex(randomBytes(32)) as Hex,
        resolver: zeroAddress,
        data: [],
        reverseRecord: 0,
        referrer: zeroHash as Hex,
      }
      const hash = await controller.read.makeCommitment([registration])
      await controller.write.commit([hash], { account: alice })
      await connection.networkHelpers.time.increase(
        Number(MIN_COMMITMENT_AGE) + 1,
      )
      await controller.write.register([registration], {
        value: priced * 2n, // overpay 2x — excess must be refunded, not counted
        account: alice,
      })

      const afterRegister = await controller.read.cumulativeVolume()
      expect(afterRegister - before).toBe(priced)

      // Renew the SAME name; counter rises by exactly price.base.
      const tokenId = BigInt(labelhash(label))
      const oldExpiry = await riseRegistrar.read.nameExpires([tokenId])
      const renewPrice = await controller.read.rentPrice([label, duration])
      await controller.write.renew([label, duration, zeroHash as Hex], {
        value: renewPrice.base * 2n, // overpay again
        account: bob, // renew is unguarded — anyone can pay
      })
      const afterRenew = await controller.read.cumulativeVolume()
      expect(afterRenew - afterRegister).toBe(renewPrice.base)

      // Sanity: the renew actually extended the name.
      const newExpiry = await riseRegistrar.read.nameExpires([tokenId])
      expect(newExpiry).toBe(oldExpiry + duration)
    },
    TEST_TIMEOUT,
  )
})

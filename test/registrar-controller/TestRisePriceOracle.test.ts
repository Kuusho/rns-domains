import { shouldSupportInterfaces } from '@ensdomains/hardhat-chai-matchers-viem/behaviour'
import hre from 'hardhat'

import { getAccounts } from '../fixtures/utils.js'

// Unit-test suite for RisePriceOracle (Plan 05-02). Coverage per D-09:
//   * Length-tier round-trip — each length 1-5+ returns rentPrices[i] * duration
//     as `base`, premium == 0 (PRICE-02 + PRICE-03 + D-04 indirect verification
//     that the _premium internal hook is wired to return 0).
//   * setRentPrices — updates the schedule, emits RentPriceChanged(uint256[5])
//     with the full new snapshot, reverts under non-owner (PRICE-04).
//   * transferOwnership — Ownable parity (D-06 — initial owner is deployer;
//     transfer to a named account works; non-owner cannot rotate).
//   * supportsInterface — true for IERC165 + IPriceOracle, false for 0xffffffff
//     (D-05 — positive + negative gate).
//   * UTF-8 rune-aware length — emoji and multibyte names price by rune count,
//     not byte count (threat T-05-05 mitigation; StringUtils.strlen).
//   * Large-duration overflow safety — 50-year duration with realistic seeds
//     does not revert and yields a finite base (threat T-05-04).
//
// Direct-deploy pattern (no rocketh-in-test) — Plan 05-04 reserves the
// loadAndExecuteDeployments fixture for the IntegrationPricing test. This
// file only exercises the contract surface.

const connection = await hre.network.connect()
const accounts = await getAccounts(connection)
const deployer = accounts[0] // Hardhat idx 0 — OZ Ownable v4 seats this account as the initial owner
const owner = accounts[1] // Hardhat idx 1 — Phase 3 D-14 / Phase 5 D-06 distinct-account pattern
const stranger = accounts[2] // non-owner test caller

// Per-length rent rates in wei/sec. Index maps length 1→[0], 2→[1], 3→[2],
// 4→[3], ≥5→[4]. Small integers in the unit suite keep the arithmetic auditable
// (rentPrices[i] * duration = i+1)*1000 for duration=100).
const SEEDS = [10n, 20n, 30n, 40n, 50n] as const

// Realistic production-shape seeds for the overflow-safety block — same shape
// Plan 05-03's deploy script will seed. 1- and 2-char names are 10x the 5+-char
// rate (D-02 — brand-protection through price, not through revert).
const REAL_SEEDS = [
  500_000_000n,
  500_000_000n,
  100_000_000n,
  75_000_000n,
  50_000_000n,
] as const

// Named constant for the overflow-safety test — keeps the grep audit stable
// across whitespace variants and self-documents the intent (Plan I-7).
const FIFTY_YEARS_SECONDS = 50n * 365n * 86400n

async function fixture() {
  const oracle = await connection.viem.deployContract('RisePriceOracle', [
    SEEDS as unknown as readonly bigint[],
  ])
  return { oracle }
}
const loadFixture = async () => connection.networkHelpers.loadFixture(fixture)

describe('RisePriceOracle', () => {
  // Block 1 — ERC-165 advertisement (D-05). The shouldSupportInterfaces helper
  // covers the positive ids (IERC165 + IPriceOracle); the negative-gate test
  // below probes 0xffffffff explicitly (the contract has no special-case for
  // the ERC-165 "everything" marker — it's a strict equality check).
  shouldSupportInterfaces({
    contract: () => loadFixture().then(({ oracle }) => oracle),
    interfaces: ['IERC165', 'IPriceOracle'],
  })

  it('supportsInterface(0xffffffff) returns false (negative-gate per D-05)', async () => {
    const { oracle } = await loadFixture()
    await expect(oracle.read.supportsInterface(['0xffffffff'])).resolves.toBe(
      false,
    )
  })

  describe('constructor + initial state', () => {
    it('rentPrice(length) returns the seeded value for lengths 1-5 and saturates at 5+', async () => {
      const { oracle } = await loadFixture()
      await expect(oracle.read.rentPrice([1n])).resolves.toBe(10n)
      await expect(oracle.read.rentPrice([2n])).resolves.toBe(20n)
      await expect(oracle.read.rentPrice([3n])).resolves.toBe(30n)
      await expect(oracle.read.rentPrice([4n])).resolves.toBe(40n)
      await expect(oracle.read.rentPrice([5n])).resolves.toBe(50n)
      await expect(oracle.read.rentPrice([6n])).resolves.toBe(50n)
      await expect(oracle.read.rentPrice([100n])).resolves.toBe(50n)
    })

    it('rentPrice(0) reads slot [0] (length 0 falls through to the smallest rate)', async () => {
      const { oracle } = await loadFixture()
      // strlen("") == 0 → index 0 → rentPrices[0]. Unreachable in practice via
      // a name string (PublicResolver/controller layers reject empty labels),
      // but locks the explicit `len == 0 ? 0 : len - 1` branch behaviour.
      await expect(oracle.read.rentPrice([0n])).resolves.toBe(10n)
    })

    it('owner() is the deployer immediately after construction (D-06)', async () => {
      const { oracle } = await loadFixture()
      await expect(oracle.read.owner()).resolves.toEqualAddress(
        deployer.address,
      )
    })
  })

  describe('price() — per-length dispatch (PRICE-02)', () => {
    it.each([
      ['a', 1000n],
      ['ab', 2000n],
      ['abc', 3000n],
      ['abcd', 4000n],
      ['abcde', 5000n],
      ['abcdefghijk', 5000n],
    ])(
      'price(%s) returns base=%s, premium=0n',
      async (name, expectedBase) => {
        const { oracle } = await loadFixture()
        const result = await oracle.read.price([name, 0n, 100n])
        expect(result.base).toBe(expectedBase)
        expect(result.premium).toBe(0n)
      },
    )

    it('PRICE-02 enforcement: distinct lengths produce distinct base prices for the same duration', async () => {
      const { oracle } = await loadFixture()
      const lengths = ['a', 'ab', 'abc', 'abcd', 'abcde']
      const bases = await Promise.all(
        lengths.map((n) =>
          oracle.read.price([n, 0n, 100n]).then((p) => p.base),
        ),
      )
      expect(new Set(bases).size).toBe(5)
    })
  })

  describe('price() — UTF-8 rune-aware length (threat T-05-05)', () => {
    it('emoji 🎉 (4 bytes, 1 rune) is priced as a 1-char name', async () => {
      const { oracle } = await loadFixture()
      const result = await oracle.read.price(['🎉', 0n, 100n])
      // bytes("🎉").length is 4 but StringUtils.strlen returns 1; the rune-
      // count semantics mean emoji pay the 1-char (highest-tier) rate.
      expect(result.base).toBe(1000n)
      expect(result.premium).toBe(0n)
    })

    it('multi-byte sequence "a🎉" (5 bytes, 2 runes) is priced as a 2-char name', async () => {
      const { oracle } = await loadFixture()
      const result = await oracle.read.price(['a🎉', 0n, 100n])
      expect(result.base).toBe(2000n)
      expect(result.premium).toBe(0n)
    })
  })

  describe('setRentPrices (PRICE-04)', () => {
    it('owner can update the schedule and emits RentPriceChanged with the new array', async () => {
      const { oracle } = await loadFixture()
      // deployer is still the owner at this point (no transferOwnership yet).
      const newSchedule = [100n, 200n, 300n, 400n, 500n] as const
      await expect(
        oracle.write.setRentPrices(
          [newSchedule as unknown as readonly bigint[]],
          { account: deployer },
        ),
      )
        .toEmitEvent('RentPriceChanged')
        .withArgs({ prices: newSchedule })
      await expect(oracle.read.rentPrice([5n])).resolves.toBe(500n)
      await expect(oracle.read.rentPrice([1n])).resolves.toBe(100n)
    })

    it('non-owner reverts with "Ownable: caller is not the owner"', async () => {
      const { oracle } = await loadFixture()
      await expect(
        oracle.write.setRentPrices(
          [SEEDS as unknown as readonly bigint[]],
          { account: stranger },
        ),
      ).toBeRevertedWithString('Ownable: caller is not the owner')
    })

    it('after transferOwnership, only the new owner can update', async () => {
      const { oracle } = await loadFixture()
      await oracle.write.transferOwnership([owner.address], {
        account: deployer,
      })
      // Former owner (deployer) now cannot set:
      await expect(
        oracle.write.setRentPrices(
          [SEEDS as unknown as readonly bigint[]],
          { account: deployer },
        ),
      ).toBeRevertedWithString('Ownable: caller is not the owner')
      // New owner can set:
      const replacement = [7n, 7n, 7n, 7n, 7n] as const
      await oracle.write.setRentPrices(
        [replacement as unknown as readonly bigint[]],
        { account: owner },
      )
      await expect(oracle.read.rentPrice([1n])).resolves.toBe(7n)
    })
  })

  describe('transferOwnership (D-06 — Ownable parity)', () => {
    it('deployer → named owner round-trip works', async () => {
      const { oracle } = await loadFixture()
      await expect(oracle.read.owner()).resolves.toEqualAddress(
        deployer.address,
      )
      await oracle.write.transferOwnership([owner.address], {
        account: deployer,
      })
      await expect(oracle.read.owner()).resolves.toEqualAddress(owner.address)
    })

    it('non-owner cannot transferOwnership', async () => {
      const { oracle } = await loadFixture()
      await expect(
        oracle.write.transferOwnership([stranger.address], {
          account: stranger,
        }),
      ).toBeRevertedWithString('Ownable: caller is not the owner')
    })
  })

  describe('large-duration overflow safety (threat T-05-04)', () => {
    it('50-year duration with realistic seeds does not revert and yields finite base', async () => {
      // Deploy a fresh oracle with production-shape REAL_SEEDS so the math
      // mirrors what Plan 05-03's deploy script will seed on testnet.
      const oracleReal = await connection.viem.deployContract(
        'RisePriceOracle',
        [REAL_SEEDS as unknown as readonly bigint[]],
      )
      // FIFTY_YEARS_SECONDS = 50 * 365 * 86400 = 1_576_800_000 seconds.
      // 50_000_000 wei/sec * 1_576_800_000 sec = 7.884e16 wei — well below 2^256.
      const result = await oracleReal.read.price([
        'alice',
        0n,
        FIFTY_YEARS_SECONDS,
      ])
      expect(result.base).toBe(50_000_000n * FIFTY_YEARS_SECONDS)
      expect(result.premium).toBe(0n)
    })
  })
})

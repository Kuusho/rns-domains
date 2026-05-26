import hre from 'hardhat'
import {
  type Hex,
  encodeFunctionData,
  encodePacked,
  keccak256,
  labelhash,
  namehash,
  stringToHex,
  toHex,
  zeroAddress,
  zeroHash,
} from 'viem'
import { randomBytes } from 'node:crypto'

import { getAccounts } from '../fixtures/utils.js'
import {
  registerRiseName,
  type Registration,
} from '../fixtures/registerRiseName.js'

// Unit-test suite for RiseRegistrarController — REG-08 (length) + REG-09
// (reserved) + REG-10 (setReserved owner gate). Plan 06-03 file 2/3.
//
// Coverage per 06-VALIDATION rows 06-03-07 + 06-03-08:
//   * REG-08: available() rejects len < 3 (rune-aware via StringUtils.strlen);
//     emoji single-rune labels and 3-rune CJK labels exercised.
//   * REG-09: reserved[labelHash] makes available() return false; register
//     attempt on a reserved label reverts NameNotAvailable.
//   * REG-10: setReserved(labelHash, bool) is onlyOwner + emits ReservedChanged.
//   * Toggle path: setReserved(label, false) re-opens the label.
//
// Allowlist gate (REG-11) is exercised separately in TestAllowlist.test.ts;
// to keep these tests focused on REG-08/09/10, the fixture allowlists the
// callers used here.

const connection = await hre.network.connect()
const accounts = await getAccounts(connection)
const deployer = accounts[0]
const alice = accounts[2]

const MIN_COMMITMENT_AGE = 60n
const MAX_COMMITMENT_AGE = 86400n
const ONE_YEAR = 365n * 86400n

const RENT_PRICES = [
  500_000_000n,
  500_000_000n,
  100_000_000n,
  75_000_000n,
  50_000_000n,
] as const

async function fixture() {
  const rns = await connection.viem.deployContract('RNSRegistry', [])
  const riseRegistrar = await connection.viem.deployContract('RiseRegistrar', [
    rns.address,
    namehash('rise'),
  ])
  const registrarSC = await connection.viem.deployContract(
    'RegistrarSecurityController',
    [riseRegistrar.address],
  )
  await riseRegistrar.write.transferOwnership([registrarSC.address])
  await rns.write.setSubnodeOwner([
    zeroHash,
    labelhash('rise'),
    riseRegistrar.address,
  ])

  const reverseRegistrar = await connection.viem.deployContract(
    'ReverseRegistrar',
    [rns.address],
  )
  await rns.write.setSubnodeOwner([
    zeroHash,
    labelhash('reverse'),
    deployer.address,
  ])
  await rns.write.setSubnodeOwner([
    namehash('reverse'),
    labelhash('addr'),
    reverseRegistrar.address,
  ])

  const defaultReverseRegistrar = await connection.viem.deployContract(
    'DefaultReverseRegistrar',
    [],
  )
  const priceOracle = await connection.viem.deployContract('RisePriceOracle', [
    RENT_PRICES as unknown as readonly bigint[],
  ])
  const publicResolver = await connection.viem.deployContract('PublicResolver', [
    rns.address,
    zeroAddress,
    reverseRegistrar.address,
  ])
  const controller = await connection.viem.deployContract(
    'RiseRegistrarController',
    [
      riseRegistrar.address,
      priceOracle.address,
      MIN_COMMITMENT_AGE,
      MAX_COMMITMENT_AGE,
      reverseRegistrar.address,
      defaultReverseRegistrar.address,
      rns.address,
    ],
  )
  await registrarSC.write.addRegistrarController([controller.address])
  await reverseRegistrar.write.setController([controller.address, true])
  await defaultReverseRegistrar.write.setController([controller.address, true])
  await publicResolver.write.setTrustedController([controller.address])

  // REG-11 — allowlist alice so the reserved-register-attempt test reaches
  // the reserved check (REG-09) and not the launch gate.
  await controller.write.setAllowlisted([alice.address, true])
  await controller.write.setAllowlisted([deployer.address, true])

  return {
    rns,
    riseRegistrar,
    controller,
    publicResolver,
    priceOracle,
  }
}

const loadFixture = async () => connection.networkHelpers.loadFixture(fixture)

describe('RiseRegistrarController — reserved names + length (REG-08..10)', () => {
  it('label length: available(\'ab\') returns false (len < 3 — REG-08)', async () => {
    const { controller } = await loadFixture()
    await expect(controller.read.available(['ab'])).resolves.toBe(false)
  })

  it('label length: available(\'abc\') returns true when not registered (len == 3)', async () => {
    const { controller } = await loadFixture()
    await expect(controller.read.available(['abc'])).resolves.toBe(true)
  })

  it('label length: available(emoji single rune) returns false (REG-08 rune-aware)', async () => {
    const { controller } = await loadFixture()
    // 🎉 — 1 rune. strlen returns 1 < 3; available() rejects.
    await expect(controller.read.available(['🎉'])).resolves.toBe(false)
  })

  it('label length: valid(3-rune CJK label) returns true (REG-08 rune-aware)', async () => {
    const { controller } = await loadFixture()
    // '漢字漢' — 3 CJK runes (3 * 3 bytes = 9 bytes in UTF-8).
    // strlen returns 3 ≥ 3 ⇒ valid; not reserved; not registered ⇒ available true.
    await expect(controller.read.valid(['漢字漢'])).resolves.toBe(true)
    await expect(controller.read.available(['漢字漢'])).resolves.toBe(true)
  })

  it('setReserved: owner can reserve a label and ReservedChanged is emitted', async () => {
    const { controller } = await loadFixture()
    const lh = labelhash('rise')
    await expect(
      controller.write.setReserved([lh, true]),
    )
      .toEmitEvent('ReservedChanged')
      .withArgs({ labelHash: lh, reserved: true })
    await expect(controller.read.reserved([lh])).resolves.toBe(true)
  })

  it('setReserved: called by non-owner reverts with Ownable string', async () => {
    const { controller } = await loadFixture()
    const lh = labelhash('rise')
    await expect(
      controller.write.setReserved([lh, true], { account: alice }),
    ).toBeRevertedWithString('Ownable: caller is not the owner')
  })

  it('setReserved: reserved label is unavailable — available(label) returns false post-setReserved (REG-09)', async () => {
    const { controller } = await loadFixture()
    const label = 'risebrand'
    // Pre-state: available because >=3 chars and not reserved.
    await expect(controller.read.available([label])).resolves.toBe(true)
    // Owner reserves it.
    await controller.write.setReserved([labelhash(label), true])
    await expect(controller.read.available([label])).resolves.toBe(false)
  })

  it('setReserved: reserved label register attempt reverts NameNotAvailable (REG-09 end-to-end)', async () => {
    const { controller, priceOracle } = await loadFixture()
    const label = 'risepro'
    await controller.write.setReserved([labelhash(label), true])
    // Build a registration on the reserved label and run the full commit-
    // reveal flow — register() should revert at the _available() check.
    const registration: Registration = {
      label,
      owner: alice.address,
      duration: ONE_YEAR,
      secret: toHex(randomBytes(32)) as Hex,
      resolver: zeroAddress,
      data: [],
      reverseRecord: 0,
      referrer: zeroHash as Hex,
    }
    const hash = await controller.read.makeCommitment([registration])
    await controller.write.commit([hash], { account: alice })
    await connection.networkHelpers.time.increase(Number(MIN_COMMITMENT_AGE) + 1)
    const price = await priceOracle.read.price([label, 0n, ONE_YEAR])
    await expect(
      controller.write.register([registration], {
        value: price.base + price.premium,
        account: alice,
      }),
    ).toBeRevertedWithCustomError('NameNotAvailable')
  })

  it('setReserved: setReserved(labelHash, false) clears the reservation — name becomes available (REG-10 toggle)', async () => {
    const { controller } = await loadFixture()
    const label = 'reopen01'
    const lh = labelhash(label)
    await controller.write.setReserved([lh, true])
    await expect(controller.read.available([label])).resolves.toBe(false)
    await expect(
      controller.write.setReserved([lh, false]),
    )
      .toEmitEvent('ReservedChanged')
      .withArgs({ labelHash: lh, reserved: false })
    await expect(controller.read.reserved([lh])).resolves.toBe(false)
    await expect(controller.read.available([label])).resolves.toBe(true)
  })
})

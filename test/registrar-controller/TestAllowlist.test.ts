import hre from 'hardhat'
import {
  type Hex,
  getAddress,
  labelhash,
  namehash,
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

// Unit-test suite for RiseRegistrarController — REG-11 (launch allowlist gate)
// + REG-12 (owner manages allowlist + endLaunch one-shot). Plan 06-03 file 3/3.
//
// Coverage per 06-VALIDATION row 06-03-09:
//   * REG-11: register() reverts NotAllowlisted when launchActive &&
//     !allowlisted[msg.sender]; allowlisted caller succeeds.
//   * REG-12: setAllowlisted owner-only + AllowlistedChanged event; endLaunch
//     owner-only one-shot (require pre-guard) + LaunchEnded event + post-end
//     non-allowlisted caller can register (allowlist bypass).
//   * D-06: post-endLaunch allowlist storage is NOT cleared.
//
// Fixture diverges from TestCommitReveal/TestReservedNames: NO pre-allowlist
// of caller is performed at fixture time so the REG-11 negative test can
// exercise the gate. Tests that need an allowlisted caller add it inline.

const connection = await hre.network.connect()
const accounts = await getAccounts(connection)

const deployer = accounts[0]
const owner = accounts[1] // we don't transferOwnership in this fixture — deployer is owner
const alice = accounts[2]
const bob = accounts[3]
const stranger = accounts[5]

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

  return {
    rns,
    riseRegistrar,
    controller,
    priceOracle,
  }
}

const loadFixture = async () => connection.networkHelpers.loadFixture(fixture)

describe('RiseRegistrarController — allowlist + launch (REG-11..12)', () => {
  it('allowlist: register reverts NotAllowlisted when launchActive && !allowlisted[msg.sender] (REG-11)', async () => {
    const { controller, priceOracle } = await loadFixture()
    // alice is NOT allowlisted in this fixture.
    const registration: Registration = {
      label: 'gateA01',
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
    const price = await priceOracle.read.price([
      registration.label,
      0n,
      ONE_YEAR,
    ])
    await expect(
      controller.write.register([registration], {
        value: price.base + price.premium,
        account: alice,
      }),
    ).toBeRevertedWithCustomError('NotAllowlisted')
  })

  it('allowlist: register succeeds for allowlisted caller during launch (REG-11 happy path)', async () => {
    const { controller, riseRegistrar } = await loadFixture()
    await controller.write.setAllowlisted([alice.address, true])
    const label = 'gateA02'
    await registerRiseName(
      controller,
      connection.networkHelpers,
      { label, ownerAddress: alice.address },
      { caller: alice },
    )
    const tokenId = BigInt(labelhash(label))
    await expect(
      riseRegistrar.read.ownerOf([tokenId]),
    ).resolves.toEqualAddress(alice.address)
  })

  it('setAllowlisted: owner-only — non-owner call reverts with Ownable string (REG-12)', async () => {
    const { controller } = await loadFixture()
    await expect(
      controller.write.setAllowlisted([alice.address, true], { account: alice }),
    ).toBeRevertedWithString('Ownable: caller is not the owner')
  })

  it('setAllowlisted: emits AllowlistedChanged with named-args (REG-12)', async () => {
    const { controller } = await loadFixture()
    await expect(
      controller.write.setAllowlisted([bob.address, true]),
    )
      .toEmitEvent('AllowlistedChanged')
      .withArgs({ account: getAddress(bob.address), enabled: true })
    await expect(controller.read.allowlisted([bob.address])).resolves.toBe(true)
  })

  it('endLaunch: owner-only — non-owner reverts with Ownable string (REG-12)', async () => {
    const { controller } = await loadFixture()
    await expect(
      controller.write.endLaunch({ account: alice }),
    ).toBeRevertedWithString('Ownable: caller is not the owner')
  })

  it('endLaunch: flips launchActive false and emits LaunchEnded (REG-12 / D-05)', async () => {
    const { controller } = await loadFixture()
    await expect(controller.read.launchActive()).resolves.toBe(true)
    await expect(controller.write.endLaunch()).toEmitEvent('LaunchEnded')
    await expect(controller.read.launchActive()).resolves.toBe(false)
  })

  it('endLaunch: post-endLaunch a non-allowlisted caller can register (allowlist bypassed — REG-12 full flow)', async () => {
    const { controller, riseRegistrar } = await loadFixture()
    // stranger is NOT allowlisted; the REG-11 gate would normally block.
    await controller.write.endLaunch()
    const label = 'bypass01'
    await registerRiseName(
      controller,
      connection.networkHelpers,
      { label, ownerAddress: stranger.address },
      { caller: stranger },
    )
    const tokenId = BigInt(labelhash(label))
    await expect(
      riseRegistrar.read.ownerOf([tokenId]),
    ).resolves.toEqualAddress(stranger.address)
  })

  it('endLaunch: second call reverts with the one-shot guard string "Launch already ended" (D-05)', async () => {
    const { controller } = await loadFixture()
    await controller.write.endLaunch()
    await expect(
      controller.write.endLaunch(),
    ).toBeRevertedWithString('Launch already ended')
  })

  it('endLaunch: post-endLaunch the allowlisted mapping is unchanged (D-06 historical record)', async () => {
    const { controller } = await loadFixture()
    // Owner adds an address to allowlist BEFORE endLaunch.
    await controller.write.setAllowlisted([accounts[7].address, true])
    await expect(
      controller.read.allowlisted([accounts[7].address]),
    ).resolves.toBe(true)
    // End the launch.
    await controller.write.endLaunch()
    // D-06 — the mapping is NOT cleared; the allowlisted flag is preserved
    // as historical record for future airdrops / analytics.
    await expect(
      controller.read.allowlisted([accounts[7].address]),
    ).resolves.toBe(true)
  })
})

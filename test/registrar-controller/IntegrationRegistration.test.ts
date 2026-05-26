import hre from 'hardhat'
import {
  type Address,
  type Hex,
  encodeFunctionData,
  labelhash,
  namehash,
  toHex,
  zeroAddress,
  zeroHash,
} from 'viem'
import { randomBytes } from 'node:crypto'

import { loadAndExecuteDeployments } from '../../rocketh.js'
import { getAccounts } from '../fixtures/utils.js'
import {
  commitRiseName,
  registerRiseName,
  type Registration,
} from '../fixtures/registerRiseName.js'

// Phase 6 closure-gate integration suite — D-12 in-process path. Runs the FULL
// Phase 1+2+3+4+5+6 deploy chain inline via the rocketh-in-test fixture
// (loadAndExecuteDeployments) so the integration test exercises the SAME deploy
// scripts + same wired state that Plan 06-05 Task 3's testnet deploy will
// produce. Cross-contract assertions span RNSRegistry, RiseRegistrar,
// RegistrarSecurityController, PublicResolver, RiseOwnedResolver, RisePriceOracle,
// ReverseRegistrar, DefaultReverseRegistrar, and RiseRegistrarController.
//
// Scope per Plan 06-05 must_haves + the 15 it() blocks listed in the plan:
//   * D-12 wiring (tests 1-5): addr.reverse subnode owner, 3× controllers=true,
//     all 3 Phase 6 contracts owner() == named owner.
//   * REG-01 + REG-02 (test 6): commit→wait→register happy path; ERC-721
//     ownerOf is the registration's owner.
//   * REG-02 (tests 7-8): underpayment reverts InsufficientValue; overpayment
//     refunded (controller balance == totalPrice after the call).
//   * REG-03 (test 9): renew extends expiry by exactly duration.
//   * REG-04 (test 10): register with resolver+data writes records via
//     PublicResolver.multicallWithNodeCheck.
//   * REG-05 (test 11): register with reverseRecord=1 (RISE_BIT) sets primary
//     name via ReverseRegistrar; PublicResolver.name() returns "label.rise".
//   * REG-06 (test 12): direct ReverseRegistrar.setName round-trip.
//   * REG-07 (test 13): register with reverseRecord=2 (DEFAULT_BIT) writes via
//     defaultReverseRegistrar; nameForAddr returns the set name.
//   * REG-08 + REG-09 (test 14): available('ab') false (length < 3);
//     available('rise') false (reserved seed).
//   * REG-10 + REG-11 + REG-12 (test 15): owner adds 'foo' to reserved →
//     unavailable; owner endLaunch → non-allowlisted can register; D-06
//     allowlist mapping not cleared.
//
// Pattern 5 cast: connection.provider is cast to `never` to bypass the
// EIP1193Provider type strictness, mirroring hardhat-deploy's own wrapper.
// saveDeployments=false because the edr-simulated state is ephemeral.

const connection = await hre.network.connect()
const accounts = await getAccounts(connection)

async function fixture() {
  // Run the full Phase 1-6 deploy chain inside the test process. All 16
  // rocketh scripts execute (Phase 2 registry+root → Phase 3 registrar+SC →
  // Phase 4 resolvers → Phase 5 price oracle → Phase 6 reverse-registrars +
  // controller + activation gates).
  const env = await loadAndExecuteDeployments({
    provider: connection.provider as never,
    network: connection.networkName,
    saveDeployments: false,
    askBeforeProceeding: false,
    logLevel: 0,
  })

  const rnsRegistry = await connection.viem.getContractAt(
    'RNSRegistry',
    env.deployments.RNSRegistry.address as `0x${string}`,
  )
  const rnsRoot = await connection.viem.getContractAt(
    'RNSRoot',
    env.deployments.RNSRoot.address as `0x${string}`,
  )
  const riseRegistrar = await connection.viem.getContractAt(
    'RiseRegistrar',
    env.deployments.RiseRegistrar.address as `0x${string}`,
  )
  const sc = await connection.viem.getContractAt(
    'RegistrarSecurityController',
    env.deployments.RegistrarSecurityController.address as `0x${string}`,
  )
  const publicResolver = await connection.viem.getContractAt(
    'PublicResolver',
    env.deployments.PublicResolver.address as `0x${string}`,
  )
  const riseOwnedResolver = await connection.viem.getContractAt(
    'RiseOwnedResolver',
    env.deployments.RiseOwnedResolver.address as `0x${string}`,
  )
  // Read the price oracle through the IPriceOracle interface — the surface
  // the controller consumes. Phase 5 D-09 idiom: interface-typed read keeps
  // the integration assert aligned with the controller's call site.
  const priceOracle = await connection.viem.getContractAt(
    'IPriceOracle',
    env.deployments.RisePriceOracle.address as `0x${string}`,
  )
  const reverseRegistrar = await connection.viem.getContractAt(
    'ReverseRegistrar',
    env.deployments.ReverseRegistrar.address as `0x${string}`,
  )
  const defaultReverseRegistrar = await connection.viem.getContractAt(
    'DefaultReverseRegistrar',
    env.deployments.DefaultReverseRegistrar.address as `0x${string}`,
  )
  const controller = await connection.viem.getContractAt(
    'RiseRegistrarController',
    env.deployments.RiseRegistrarController.address as `0x${string}`,
  )

  return {
    rnsRegistry,
    rnsRoot,
    riseRegistrar,
    sc,
    publicResolver,
    riseOwnedResolver,
    priceOracle,
    reverseRegistrar,
    defaultReverseRegistrar,
    controller,
  }
}

const loadFixture = async () => connection.networkHelpers.loadFixture(fixture)

// rocketh.ts namedAccounts: `deployer` = Hardhat index 0; `owner` = Hardhat
// index 1. Phase 6's controller, ReverseRegistrar, and DefaultReverseRegistrar
// all transfer ownership to the named owner during their deploy scripts.
const owner = accounts[1]
const alice = accounts[2]
const bob = accounts[3]
const stranger = accounts[5]

const MIN_COMMITMENT_AGE = 60n
const ONE_YEAR = 365n * 86400n
const ADDR_REVERSE_NODE = namehash('addr.reverse')

describe('IntegrationRegistration (Phase 6 — MVP closure gate, D-12 in-process path)', () => {
  it('D-12 wiring: addr.reverse subnode owner == ReverseRegistrar.address (REG-06 deploy-state)', async () => {
    const { rnsRegistry, reverseRegistrar } = await loadFixture()
    await expect(
      rnsRegistry.read.owner([ADDR_REVERSE_NODE]),
    ).resolves.toEqualAddress(reverseRegistrar.address)
  })

  it('D-12 wiring: RiseRegistrar.controllers(controller) == true (REG-13 part 1)', async () => {
    const { riseRegistrar, controller } = await loadFixture()
    await expect(
      riseRegistrar.read.controllers([controller.address]),
    ).resolves.toBe(true)
  })

  it('D-12 wiring: ReverseRegistrar.controllers(controller) == true (REG-13 part 2)', async () => {
    const { reverseRegistrar, controller } = await loadFixture()
    await expect(
      reverseRegistrar.read.controllers([controller.address]),
    ).resolves.toBe(true)
  })

  it('D-12 wiring: DefaultReverseRegistrar.controllers(controller) == true (REG-13 part 3)', async () => {
    const { defaultReverseRegistrar, controller } = await loadFixture()
    await expect(
      defaultReverseRegistrar.read.controllers([controller.address]),
    ).resolves.toBe(true)
  })

  it('D-12 wiring: all 3 Phase 6 contracts owner() == named owner account', async () => {
    const { reverseRegistrar, defaultReverseRegistrar, controller } =
      await loadFixture()
    await expect(reverseRegistrar.read.owner()).resolves.toEqualAddress(
      owner.address,
    )
    await expect(defaultReverseRegistrar.read.owner()).resolves.toEqualAddress(
      owner.address,
    )
    await expect(controller.read.owner()).resolves.toEqualAddress(owner.address)
  })

  it('REG-01..02 happy path: owner allowlists caller → commit → wait → register → ERC-721 owner correct', async () => {
    const { controller, riseRegistrar } = await loadFixture()
    // Phase 6 D-11: launchActive defaults true, allowlist is empty at deploy
    // time. Owner allowlists alice so REG-11 doesn't block.
    await controller.write.setAllowlisted([alice.address, true], {
      account: owner,
    })
    const label = 'alice'
    const tokenId = BigInt(labelhash(label))
    // Full commit→wait→register flow via the shared helper (cross-contract:
    // controller → RegistrarSecurityController → RiseRegistrar → registry).
    await registerRiseName(
      controller,
      connection.networkHelpers,
      { label, ownerAddress: alice.address },
      { caller: alice },
    )
    await expect(
      riseRegistrar.read.ownerOf([tokenId]),
    ).resolves.toEqualAddress(alice.address)
  })

  it('REG-02: underpayment reverts InsufficientValue', async () => {
    const { controller, priceOracle } = await loadFixture()
    await controller.write.setAllowlisted([alice.address, true], {
      account: owner,
    })
    const label = 'underA01'
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
        value: price.base + price.premium - 1n,
        account: alice,
      }),
    ).toBeRevertedWithCustomError('InsufficientValue')
  })

  it('REG-02: overpayment refunded — controller balance equals exactly totalPrice after register', async () => {
    const { controller, priceOracle } = await loadFixture()
    await controller.write.setAllowlisted([alice.address, true], {
      account: owner,
    })
    const label = 'overpyA01'
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
    const total = price.base + price.premium
    const overpay = 10n ** 17n // 0.1 ETH overpayment
    const publicClient = await connection.viem.getPublicClient()
    const before = await publicClient.getBalance({ address: controller.address })
    await controller.write.register([registration], {
      value: total + overpay,
      account: alice,
    })
    const after = await publicClient.getBalance({ address: controller.address })
    // Pitfall 2 — refund (overpay) is the LAST statement in register; the
    // controller keeps exactly totalPrice, refunds the overpay to msg.sender.
    expect(after - before).toBe(total)
  })

  it('REG-03: renew extends expiry by duration', async () => {
    const { controller, riseRegistrar, priceOracle } = await loadFixture()
    await controller.write.setAllowlisted([alice.address, true], {
      account: owner,
    })
    const label = 'renewA01'
    await registerRiseName(
      controller,
      connection.networkHelpers,
      { label, ownerAddress: alice.address },
      { caller: alice },
    )
    const tokenId = BigInt(labelhash(label))
    const oldExpiry = await riseRegistrar.read.nameExpires([tokenId])
    const renewPrice = await priceOracle.read.price([label, oldExpiry, ONE_YEAR])
    await controller.write.renew([label, ONE_YEAR, zeroHash as Hex], {
      value: renewPrice.base,
      account: bob, // renew is unguarded — anyone can pay (reference UX).
    })
    const newExpiry = await riseRegistrar.read.nameExpires([tokenId])
    expect(newExpiry).toBe(oldExpiry + ONE_YEAR)
  })

  it('REG-04: register with resolver+data writes records via PublicResolver.multicallWithNodeCheck', async () => {
    const { controller, publicResolver } = await loadFixture()
    // The deploy chain leaves PublicResolver.trustedController == 0 (Phase 4
    // 00_deploy_public_resolver.ts D-01 — owner-only setter wired at Phase 6).
    // Wire it here so the controller's multicallWithNodeCheck inner-call
    // setAddr bypasses the authorised(node) check.
    await publicResolver.write.setTrustedController([controller.address], {
      account: owner,
    })
    await controller.write.setAllowlisted([alice.address, true], {
      account: owner,
    })

    const label = 'multiA01'
    const expectedNamehash = namehash(`${label}.rise`)
    const setAddrCall = encodeFunctionData({
      abi: publicResolver.abi,
      functionName: 'setAddr',
      args: [expectedNamehash, bob.address],
    })
    await registerRiseName(
      controller,
      connection.networkHelpers,
      {
        label,
        ownerAddress: alice.address,
        resolver: publicResolver.address,
        data: [setAddrCall],
      },
      { caller: alice },
    )
    // The setAddr inner-call should have populated bob's address as the addr
    // record on alice's new name. Cross-contract assertion: controller →
    // resolver → registry binding all wired correctly.
    await expect(
      publicResolver.read.addr([expectedNamehash]) as Promise<Address>,
    ).resolves.toEqualAddress(bob.address)
  })

  it('REG-05: register with reverseRecord=1 (RISE_BIT) sets primary name via ReverseRegistrar', async () => {
    const { controller, publicResolver, reverseRegistrar, rnsRegistry } =
      await loadFixture()
    // Wire PublicResolver's two trust slots so:
    //  - the controller's mid-registration multicallWithNodeCheck for the
    //    forward record bypasses authorised(node) (trustedController);
    //  - the ReverseRegistrar's setName call on PublicResolver inside the
    //    REVERSE_RECORD_RISE_BIT path bypasses authorised(node)
    //    (trustedReverseRegistrar).
    // Both trusted slots are owner-only setters left at 0 by Phase 4 deploy
    // (Plan 04-04 D-01); Phase 6 wires them via these post-deploy calls.
    await publicResolver.write.setTrustedController([controller.address], {
      account: owner,
    })
    await publicResolver.write.setTrustedReverseRegistrar(
      [reverseRegistrar.address],
      { account: owner },
    )
    await controller.write.setAllowlisted([alice.address, true], {
      account: owner,
    })

    const label = 'revRA01'
    const expectedNamehash = namehash(`${label}.rise`)
    const setAddrCall = encodeFunctionData({
      abi: publicResolver.abi,
      functionName: 'setAddr',
      args: [expectedNamehash, alice.address],
    })
    await registerRiseName(
      controller,
      connection.networkHelpers,
      {
        label,
        ownerAddress: alice.address,
        resolver: publicResolver.address,
        data: [setAddrCall],
        reverseRecord: 1, // REVERSE_RECORD_RISE_BIT
      },
      { caller: alice },
    )
    // Cross-contract: controller → reverseRegistrar.setNameForAddr →
    // rnsRegistry.setSubnodeRecord seats the alice-reverse node owned by
    // alice; the controller's call also points the reverse node's resolver at
    // PublicResolver (via reverseRegistrar.defaultResolver passthrough) and
    // writes name='label.rise'.
    const aliceReverseNode = await reverseRegistrar.read.node([alice.address])
    await expect(rnsRegistry.read.owner([aliceReverseNode])).resolves.toEqualAddress(
      alice.address,
    )
    await expect(
      publicResolver.read.name([aliceReverseNode]),
    ).resolves.toEqual(`${label}.rise`)
  })

  it('REG-06 standalone: ReverseRegistrar.setName(name) round-trip resolves back via PublicResolver', async () => {
    const { reverseRegistrar, publicResolver } = await loadFixture()
    // Per Phase 6 plan 01: ReverseRegistrar.setName() points the caller's
    // reverse node at defaultResolver and writes the name there. Wire (a)
    // defaultResolver = PublicResolver from owner; (b) PublicResolver's
    // trustedReverseRegistrar slot so the resolver's setName(node, name) call
    // from ReverseRegistrar bypasses authorised(node).
    await reverseRegistrar.write.setDefaultResolver([publicResolver.address], {
      account: owner,
    })
    await publicResolver.write.setTrustedReverseRegistrar(
      [reverseRegistrar.address],
      { account: owner },
    )
    const name = 'mariella.rise'
    await reverseRegistrar.write.setName([name], { account: alice })
    const aliceReverseNode = await reverseRegistrar.read.node([alice.address])
    await expect(
      publicResolver.read.name([aliceReverseNode]),
    ).resolves.toEqual(name)
  })

  it('REG-07: DefaultReverseRegistrar.nameForAddr returns the set name post-register with reverseRecord=2 (DEFAULT_BIT)', async () => {
    const { controller, publicResolver, defaultReverseRegistrar } =
      await loadFixture()
    await publicResolver.write.setTrustedController([controller.address], {
      account: owner,
    })
    await controller.write.setAllowlisted([alice.address, true], {
      account: owner,
    })

    const label = 'revDA01'
    const expectedNamehash = namehash(`${label}.rise`)
    const setAddrCall = encodeFunctionData({
      abi: publicResolver.abi,
      functionName: 'setAddr',
      args: [expectedNamehash, alice.address],
    })
    await registerRiseName(
      controller,
      connection.networkHelpers,
      {
        label,
        ownerAddress: alice.address,
        resolver: publicResolver.address,
        data: [setAddrCall],
        reverseRecord: 2, // REVERSE_RECORD_DEFAULT_BIT
      },
      { caller: alice },
    )
    await expect(
      defaultReverseRegistrar.read.nameForAddr([alice.address]),
    ).resolves.toEqual(`${label}.rise`)
  })

  it('REG-08 + REG-09: available("ab") is false (length < 3) AND available("rise") is false (reserved seed)', async () => {
    const { controller } = await loadFixture()
    await expect(controller.read.available(['ab'])).resolves.toBe(false)
    // 'rise' is in the 24-label reserved seed loop from
    // deploy/registrar-controller/01_deploy_rise_registrar_controller.ts.
    await expect(controller.read.available(['rise'])).resolves.toBe(false)
  })

  it('REG-10 + REG-11 + REG-12: setReserved + endLaunch + post-end non-allowlisted register; D-06 allowlist retained', async () => {
    const { controller, riseRegistrar } = await loadFixture()
    // REG-10 — owner reserves 'foo'.
    await controller.write.setReserved(
      [labelhash('foo'), true],
      { account: owner },
    )
    await expect(controller.read.available(['foo'])).resolves.toBe(false)

    // Pre-allowlist bob BEFORE endLaunch — D-06 retention check below uses
    // this address.
    await controller.write.setAllowlisted([bob.address, true], {
      account: owner,
    })
    await expect(controller.read.allowlisted([bob.address])).resolves.toBe(true)

    // REG-12 — owner ends the launch.
    await controller.write.endLaunch({ account: owner })
    await expect(controller.read.launchActive()).resolves.toBe(false)

    // REG-11 — post-endLaunch, non-allowlisted stranger can register.
    const label = 'baz123'
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

    // D-06 — allowlist mapping NOT cleared by endLaunch; bob's entry remains.
    await expect(controller.read.allowlisted([bob.address])).resolves.toBe(true)
  })
})

import { shouldSupportInterfaces } from '@ensdomains/hardhat-chai-matchers-viem/behaviour'
import hre from 'hardhat'
import {
  type Address,
  encodePacked,
  getAddress,
  keccak256,
  labelhash,
  namehash,
  toFunctionSelector,
  zeroAddress,
  zeroHash,
} from 'viem'

import { getAccounts } from '../fixtures/utils.js'

// Unit-test suite for ReverseRegistrar (Plan 06-01). Coverage per the plan's
// must_haves and 06-VALIDATION rows 06-01-01..06-01-03:
//   * ERC-165 introspection — IERC165 + IReverseRegistrar (runtime XOR of the
//     7 reference function selectors). Hallucination-proof per Phase 5 D-09.
//   * node(address) — chain-agnostic addr.reverse namehash invariant.
//     keccak256(ADDR_REVERSE_NODE || sha3HexAddress(addr)) where
//     sha3HexAddress is keccak256(<lowercase 40-char hex of addr>).
//   * setName (self path) — emits ReverseClaimed, writes the registry's reverse
//     subnode owner to msg.sender (Pitfall 7 — msg.sender authorship).
//   * setNameForAddr (controller path) — writes the reverse record FOR the
//     `addr` field, not the caller; controller-gated via RNSControllable.
//   * authorised modifier — non-controller non-self non-approved revert with
//     the frozen reference string (Phase 2 D-07 lineage).
//   * setDefaultResolver — owner-gated; zero-address frozen revert string.
//   * setController — REG-13 part 2 surface inherited from RNSControllable;
//     positive registration + ControllerChanged event + revoke.
//   * ownsContract bypass — Ownable.owner() == msg.sender passes the gate.
//   * claim forwards via defaultResolver — round-trip with a wired resolver.
//
// Direct-deploy pattern (no rocketh-in-test) — Plan 06-05 reserves the
// loadAndExecuteDeployments fixture for the IntegrationRegistration test.
// This file only exercises the contract surface.

const connection = await hre.network.connect()
const accounts = await getAccounts(connection)
const deployer = accounts[0] // OZ Ownable v4 seats this as the initial owner
const alice = accounts[1] // self-claim path subject
const bob = accounts[2] // controller / external caller
const carol = accounts[3] // setNameForAddr subject

// Runtime-computed selectors — XOR all 7 to derive IReverseRegistrar.interfaceId.
// Compared on-chain via reverseRegistrar.read.supportsInterface([id]).
const REVERSE_REGISTRAR_SELECTORS = [
  toFunctionSelector('function setDefaultResolver(address) external'),
  toFunctionSelector('function claim(address) external returns (bytes32)'),
  toFunctionSelector(
    'function claimForAddr(address,address,address) external returns (bytes32)',
  ),
  toFunctionSelector(
    'function claimWithResolver(address,address) external returns (bytes32)',
  ),
  toFunctionSelector(
    'function setName(string) external returns (bytes32)',
  ),
  toFunctionSelector(
    'function setNameForAddr(address,address,address,string) external returns (bytes32)',
  ),
  toFunctionSelector('function node(address) external pure returns (bytes32)'),
] as const

const I_REVERSE_REGISTRAR_INTERFACE_ID =
  REVERSE_REGISTRAR_SELECTORS.reduce<`0x${string}`>(
    (acc, s) =>
      `0x${(BigInt(acc) ^ BigInt(s))
        .toString(16)
        .padStart(8, '0')}` as `0x${string}`,
    '0x00000000',
  )

const ADDR_REVERSE_NODE =
  '0x91d1777781884d03a6757a803996e38de2a42967fb37eeaca72729271025a9e2' as const

// JS-side replica of the contract's sha3HexAddress + node(addr) — used in
// test 2 to cross-check the on-chain pure function against the off-chain
// namehash derivation.
function sha3HexAddress(addr: Address): `0x${string}` {
  const hex = addr.toLowerCase().slice(2) // strip 0x prefix
  return keccak256(new TextEncoder().encode(hex))
}

function reverseNodeOf(addr: Address): `0x${string}` {
  return keccak256(
    encodePacked(['bytes32', 'bytes32'], [ADDR_REVERSE_NODE, sha3HexAddress(addr)]),
  )
}

async function fixture() {
  const rns = await connection.viem.deployContract('RNSRegistry', [])

  const reverseRegistrar = await connection.viem.deployContract(
    'ReverseRegistrar',
    [rns.address],
  )

  // Seat addr.reverse on the registry as a 2-level subnode of root (0x0).
  // Deployer is rns.owner(0x0) post-construction, so this 2-step handoff is
  // deployer-signed (the default account in viem).
  //   1) Create namehash('reverse') under root 0x0, owned by deployer so the
  //      next call can pass the authorised(node) gate.
  //   2) Create namehash('addr.reverse') (= ADDR_REVERSE_NODE) under
  //      namehash('reverse'), owned by the ReverseRegistrar so its
  //      setSubnodeRecord(ADDR_REVERSE_NODE, ...) calls pass authorisation.
  // Plan 06-04 will wire this via the deploy-time root handoff (D-09); this
  // unit fixture sets it directly to keep the test self-contained.
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

  // Deploy a PublicResolver with the ReverseRegistrar wired as the trusted
  // reverse-registrar bypass — this lets ReverseRegistrar.setNameForAddr
  // call PublicResolver.setName(node, name) without the resolver's
  // authorised(node) modifier reverting (PublicResolver D-06 bypass path 2).
  const publicResolver = await connection.viem.deployContract(
    'PublicResolver',
    [rns.address, zeroAddress, reverseRegistrar.address],
  )

  // Deploy a second ReverseRegistrar to serve as an Ownable contract whose
  // owner() returns deployer.address — exercises the ownsContract() bypass
  // in the authorised modifier (mirrors the reference's dummyOwnable shape).
  const dummyOwnable = await connection.viem.deployContract(
    'ReverseRegistrar',
    [rns.address],
  )

  return { rns, reverseRegistrar, publicResolver, dummyOwnable }
}

const loadFixture = async () => connection.networkHelpers.loadFixture(fixture)

describe('ReverseRegistrar', () => {
  // Block 1 — ERC-165 advertisement. The shouldSupportInterfaces helper
  // covers IERC165 by name; the block below verifies IReverseRegistrar via
  // a runtime-XOR of the 7 reference function selectors (D-09 idiom).
  shouldSupportInterfaces({
    contract: () => loadFixture().then(({ reverseRegistrar }) => reverseRegistrar),
    interfaces: ['IERC165'],
  })

  it('supports IReverseRegistrar via supportsInterface', async () => {
    const { reverseRegistrar } = await loadFixture()
    await expect(
      reverseRegistrar.read.supportsInterface([I_REVERSE_REGISTRAR_INTERFACE_ID]),
    ).resolves.toBe(true)
    // negative gate — 0xffffffff is the ERC-165 "everything" marker which
    // the contract MUST NOT advertise as supported.
    await expect(
      reverseRegistrar.read.supportsInterface(['0xffffffff']),
    ).resolves.toBe(false)
  })

  it('node(address) returns keccak256(ADDR_REVERSE_NODE || sha3HexAddress(addr)) for any address', async () => {
    const { reverseRegistrar } = await loadFixture()
    const onchain = await reverseRegistrar.read.node([alice.address])
    expect(onchain.toLowerCase()).toBe(reverseNodeOf(alice.address))
    // Sanity-check a second address to lock the chain-agnostic invariant.
    const onchainBob = await reverseRegistrar.read.node([bob.address])
    expect(onchainBob.toLowerCase()).toBe(reverseNodeOf(bob.address))
  })

  it('setName as msg.sender writes the reverse name and emits ReverseClaimed', async () => {
    const { rns, reverseRegistrar, publicResolver } = await loadFixture()

    // Default-resolver path: setName forwards to setNameForAddr(msg.sender,
    // msg.sender, defaultResolver, name). Wire the defaultResolver first.
    await reverseRegistrar.write.setDefaultResolver([publicResolver.address])

    const expectedNode = reverseNodeOf(alice.address)
    await expect(
      reverseRegistrar.write.setName(['alice.rise'], { account: alice }),
    )
      .toEmitEvent('ReverseClaimed')
      .withArgs({
        addr: getAddress(alice.address),
        node: expectedNode,
      })

    await expect(rns.read.owner([expectedNode])).resolves.toEqualAddress(
      alice.address,
    )
    await expect(rns.read.resolver([expectedNode])).resolves.toEqualAddress(
      publicResolver.address,
    )
    await expect(
      publicResolver.read.name([expectedNode]),
    ).resolves.toEqual('alice.rise')
  })

  it('setNameForAddr writes the reverse record for the addr field, not the caller (Pitfall 7)', async () => {
    const { rns, reverseRegistrar, publicResolver } = await loadFixture()

    // bob is the controller; carol is the reverse-record subject.
    // After setController([bob, true]) (owner-signed by deployer), bob can
    // call setNameForAddr on carol's behalf.
    await reverseRegistrar.write.setController([bob.address, true])
    await reverseRegistrar.write.setNameForAddr(
      [
        carol.address,
        carol.address,
        publicResolver.address,
        'carol.rise',
      ],
      { account: bob },
    )

    const carolNode = reverseNodeOf(carol.address)
    // The reverse record was set FOR carol (the addr field), not bob (the caller).
    await expect(rns.read.owner([carolNode])).resolves.toEqualAddress(
      carol.address,
    )
    await expect(rns.read.resolver([carolNode])).resolves.toEqualAddress(
      publicResolver.address,
    )
    await expect(publicResolver.read.name([carolNode])).resolves.toEqual(
      'carol.rise',
    )

    // bob's own reverse node must NOT have been touched.
    const bobNode = reverseNodeOf(bob.address)
    await expect(rns.read.owner([bobNode])).resolves.toEqualAddress(
      zeroAddress,
    )
  })

  it('authorised modifier reverts non-controller non-self non-approved with the frozen string', async () => {
    const { reverseRegistrar, publicResolver } = await loadFixture()
    // alice tries to claim publicResolver's reverse node — publicResolver is
    // an Ownable contract whose owner is deployer (NOT alice), so
    // ownsContract returns false cleanly (catch is not triggered because the
    // owner() call succeeds, it just returns a different address). alice is
    // also not publicResolver itself, not a controller, and not approved by
    // publicResolver — so all 4 disjuncts of the authorised modifier are
    // false and the frozen revert string fires.
    await expect(
      reverseRegistrar.write.claimForAddr(
        [publicResolver.address, alice.address, zeroAddress],
        { account: alice },
      ),
    ).toBeRevertedWithString(
      'ReverseRegistrar: Caller is not a controller or authorised by address or the address itself',
    )
  })

  it('setDefaultResolver rejects address(0) with the frozen string', async () => {
    const { reverseRegistrar } = await loadFixture()
    await expect(
      reverseRegistrar.write.setDefaultResolver([zeroAddress]),
    ).toBeRevertedWithString(
      'ReverseRegistrar: Resolver address must not be 0',
    )
  })

  it('setDefaultResolver from non-owner reverts with the OZ v4 string', async () => {
    const { reverseRegistrar, publicResolver } = await loadFixture()
    await expect(
      reverseRegistrar.write.setDefaultResolver([publicResolver.address], {
        account: alice,
      }),
    ).toBeRevertedWithString('Ownable: caller is not the owner')
  })

  it('setController(controller, true) registers the caller on the controllers mapping (REG-13 surface)', async () => {
    const { reverseRegistrar } = await loadFixture()
    await expect(
      reverseRegistrar.write.setController([bob.address, true]),
    )
      .toEmitEvent('ControllerChanged')
      .withArgs({ controller: getAddress(bob.address), enabled: true })

    await expect(
      reverseRegistrar.read.controllers([bob.address]),
    ).resolves.toBe(true)
  })

  it('setController(controller, false) revokes', async () => {
    const { reverseRegistrar } = await loadFixture()
    await reverseRegistrar.write.setController([bob.address, true])
    await expect(
      reverseRegistrar.write.setController([bob.address, false]),
    )
      .toEmitEvent('ControllerChanged')
      .withArgs({ controller: getAddress(bob.address), enabled: false })

    await expect(
      reverseRegistrar.read.controllers([bob.address]),
    ).resolves.toBe(false)
  })

  it('ownsContract bypass: a contract whose Ownable.owner() is msg.sender passes the authorised gate', async () => {
    const { rns, reverseRegistrar, dummyOwnable, publicResolver } =
      await loadFixture()

    // dummyOwnable is a second ReverseRegistrar — its OZ Ownable owner is
    // the deployer (the default account in viem). The deployer therefore
    // satisfies the authorised(dummyOwnable.address) check via ownsContract.
    await reverseRegistrar.write.claimForAddr([
      dummyOwnable.address,
      deployer.address,
      publicResolver.address,
    ])

    const dummyNode = reverseNodeOf(dummyOwnable.address)
    await expect(rns.read.owner([dummyNode])).resolves.toEqualAddress(
      deployer.address,
    )
    await expect(rns.read.resolver([dummyNode])).resolves.toEqualAddress(
      publicResolver.address,
    )
  })

  it('claim(owner) forwards to claimForAddr with defaultResolver and msg.sender as addr', async () => {
    const { rns, reverseRegistrar, publicResolver } = await loadFixture()
    await reverseRegistrar.write.setDefaultResolver([publicResolver.address])

    await reverseRegistrar.write.claim([alice.address], { account: alice })

    const aliceNode = reverseNodeOf(alice.address)
    await expect(rns.read.owner([aliceNode])).resolves.toEqualAddress(
      alice.address,
    )
    await expect(rns.read.resolver([aliceNode])).resolves.toEqualAddress(
      publicResolver.address,
    )
  })
})

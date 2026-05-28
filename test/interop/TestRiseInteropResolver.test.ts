import hre from 'hardhat'
import { labelhash, namehash, zeroAddress, type Address, type Hex } from 'viem'

// Hand-wired unit suite for the Phase-8 RiseInteropResolver (Plan 08-02, INTEROP-01).
//
// Mirrors the fixture shape of TestRiseRegistrar / TestSubdomainRegistrar: deploy
// RNSRegistry, deploy a PublicResolver, wire a node to that resolver, set the
// node's primary EVM addr, then deploy RiseInteropResolver with a chosen chainId.
// No rocketh here — the full-chain end-to-end path lives in the Wave-3
// IntegrationInterop.test.ts.
//
// The encoder is pinned to TWO golden vectors (Pitfall 4 — an off-by-one or wrong
// byte order MUST fail these exact-byte assertions):
//   * chainId 1   (mainnet, vitalik): ERC-7930 spec Example 1
//   * chainId 11155931 (RiseChain testnet): chainRef 0xaa39db
// plus the two revert paths (D-11 / Pitfall 5: NoPrimaryAddress, NoResolver) and
// the chainId getter (D-10 injection).
//
// `-t` filter token embedded in describe title: interop.

const connection = await hre.network.connect()
const [ownerClient, otherClient] = await connection.viem.getWalletClients()
const ownerAccount = ownerClient.account

// The .rise TLD node + a 2LD label we wire a resolver onto.
const LABEL = 'agent'
const NAME = `${LABEL}.rise`
const node = namehash(NAME) as Hex

// ERC-7930 mainnet golden vector (spec Example 1) — vitalik on chainId 1.
const VITALIK = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045' as Address
const MAINNET_VECTOR =
  '0x00010000010114d8da6bf26964af9d7eed9e03e53415d37aa96045'
// RiseChain testnet (chainId 11155931 == 0xaa39db) prefix: Version|ChainType|
// ChainRefLen(03)|ChainRef(aa39db)|AddrLen(14). The 20-byte address is appended.
const TESTNET_PREFIX = '0x0001000003aa39db14'

/**
 * Deploy RNSRegistry + PublicResolver, give `ownerAccount` the `agent.rise`
 * node, point it at the resolver, and deploy RiseInteropResolver with `chainId`.
 * When `primary` is supplied, set it as the node's COIN_TYPE_ETH addr.
 */
async function makeFixture(chainId: bigint, primary?: Address) {
  const rns = await connection.viem.deployContract('RNSRegistry', [])
  const resolver = await connection.viem.deployContract('PublicResolver', [
    rns.address,
    zeroAddress,
    zeroAddress,
  ])

  // Wire ownerAccount as the owner of `agent.rise` so it may set the resolver.
  // zeroHash -> 'rise' -> 'agent.rise', all owned by ownerAccount.
  await rns.write.setSubnodeOwner([
    '0x0000000000000000000000000000000000000000000000000000000000000000',
    labelhash('rise'),
    ownerAccount.address,
  ])
  await rns.write.setSubnodeOwner([namehash('rise'), labelhash(LABEL), ownerAccount.address])
  await rns.write.setResolver([node, resolver.address])

  if (primary) {
    await resolver.write.setAddr([node, primary])
  }

  const interopResolver = await connection.viem.deployContract(
    'RiseInteropResolver',
    [rns.address, chainId],
  )

  return { rns, resolver, interopResolver }
}

describe('RiseInteropResolver (interop)', () => {
  it('encodes the ERC-7930 mainnet golden vector (chainId 1)', async () => {
    const { interopResolver } = await makeFixture(1n, VITALIK)
    const encoded = await interopResolver.read.interopAddress([node])
    // EXACT bytes — version|chaintype|chainreflen(01)|chainref(01)|addrlen(14)|addr.
    expect(encoded.toLowerCase()).toBe(MAINNET_VECTOR.toLowerCase())
  })

  it('encodes the RiseChain testnet vector (chainId 11155931)', async () => {
    // Use a real wallet-client address as the known primary `A`.
    const A = ownerAccount.address as Address
    const { interopResolver } = await makeFixture(11155931n, A)
    const encoded = await interopResolver.read.interopAddress([node])
    const expected = (TESTNET_PREFIX + A.slice(2).toLowerCase()) as Hex
    expect(encoded.toLowerCase()).toBe(expected.toLowerCase())
    // 29 bytes total (2 ver + 2 chaintype + 1 reflen + 3 chainref + 1 addrlen +
    // 20 addr) => 0x + 58 hex chars = 60-char string (Pitfall 4 length check).
    expect(encoded.length).toBe(60)
  })

  it('reverts NoPrimaryAddress when addr(node) is unset', async () => {
    // Wire a resolver but set NO addr — addr(node) returns address(0).
    const { interopResolver } = await makeFixture(11155931n)
    await expect(
      interopResolver.read.interopAddress([node]),
    ).toBeRevertedWithCustomError('NoPrimaryAddress')
  })

  it('reverts NoResolver when the node has no resolver', async () => {
    const { interopResolver } = await makeFixture(11155931n, VITALIK)
    // A node that was never given a resolver in the registry.
    const orphan = namehash('no-resolver-here.rise') as Hex
    await expect(
      interopResolver.read.interopAddress([orphan]),
    ).toBeRevertedWithCustomError('NoResolver')
  })

  it('chainId getter returns the injected value', async () => {
    const { interopResolver } = await makeFixture(11155931n, VITALIK)
    await expect(interopResolver.read.chainId()).resolves.toBe(11155931n)

    const mainnet = await makeFixture(1n, VITALIK)
    await expect(mainnet.interopResolver.read.chainId()).resolves.toBe(1n)
  })
})

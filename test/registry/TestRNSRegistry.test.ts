import hre from 'hardhat'
import { getAddress, labelhash, namehash, padHex, zeroHash } from 'viem'

import { getAccounts } from '../fixtures/utils.js'

const placeholderAddr = padHex('0x1234', { size: 20 })
const secondResolver = padHex('0x5678', { size: 20 })

const connection = await hre.network.connect()
const accounts = await getAccounts(connection)

async function fixture() {
  const rnsRegistry = await connection.viem.deployContract('RNSRegistry', [])

  return { rnsRegistry }
}
const loadFixture = async () => connection.networkHelpers.loadFixture(fixture)

describe('RNSRegistry', () => {
  // --- Ported from ENS's TestENS.test.ts (D-08 conformance gate) ---

  it('should allow ownership transfers', async () => {
    const { rnsRegistry } = await loadFixture()

    await expect(rnsRegistry.write.setOwner([zeroHash, placeholderAddr]))
      .toEmitEvent('Transfer')
      .withArgs({ node: zeroHash, owner: placeholderAddr })

    await expect(rnsRegistry.read.owner([zeroHash])).resolves.toEqual(
      placeholderAddr,
    )
  })

  it('should prohibit transfers by non-owners', async () => {
    const { rnsRegistry } = await loadFixture()

    await expect(
      rnsRegistry.write.setOwner([
        padHex('0x01', { size: 32 }),
        placeholderAddr,
      ]),
    ).toBeRevertedWithoutReason()
  })

  it('should allow setting resolvers', async () => {
    const { rnsRegistry } = await loadFixture()

    await expect(rnsRegistry.write.setResolver([zeroHash, placeholderAddr]))
      .toEmitEvent('NewResolver')
      .withArgs({ node: zeroHash, resolver: placeholderAddr })

    await expect(rnsRegistry.read.resolver([zeroHash])).resolves.toEqual(
      placeholderAddr,
    )
  })

  it('should prevent setting resolvers by non-owners', async () => {
    const { rnsRegistry } = await loadFixture()

    await expect(
      rnsRegistry.write.setResolver([
        padHex('0x01', { size: 32 }),
        placeholderAddr,
      ]),
    ).toBeRevertedWithoutReason()
  })

  it('should allow setting the TTL', async () => {
    const { rnsRegistry } = await loadFixture()

    await expect(rnsRegistry.write.setTTL([zeroHash, 3600n]))
      .toEmitEvent('NewTTL')
      .withArgs({ node: zeroHash, ttl: 3600n })

    await expect(rnsRegistry.read.ttl([zeroHash])).resolves.toEqual(3600n)
  })

  it('should prevent setting the TTL by non-owners', async () => {
    const { rnsRegistry } = await loadFixture()

    await expect(
      rnsRegistry.write.setTTL([padHex('0x01', { size: 32 }), 3600n]),
    ).toBeRevertedWithoutReason()
  })

  it('should allow the creation of subnodes', async () => {
    const { rnsRegistry } = await loadFixture()

    await expect(
      rnsRegistry.write.setSubnodeOwner([
        zeroHash,
        labelhash('rise'),
        accounts[1].address,
      ]),
    )
      .toEmitEvent('NewOwner')
      .withArgs({
        node: zeroHash,
        label: labelhash('rise'),
        owner: getAddress(accounts[1].address),
      })

    await expect(
      rnsRegistry.read.owner([namehash('rise')]),
    ).resolves.toEqualAddress(accounts[1].address)
  })

  it('should prohibit subnode creation by non-owners', async () => {
    const { rnsRegistry } = await loadFixture()

    await expect(
      rnsRegistry.write.setSubnodeOwner(
        [zeroHash, labelhash('rise'), accounts[1].address],
        { account: accounts[1] },
      ),
    ).toBeRevertedWithoutReason()
  })

  // --- RNS-specific add-on cases (D-08 "add RNS-specific tests";
  //     close the CORE-02 coverage gap TestENS leaves) ---

  it('should set owner, resolver and ttl via setSubnodeRecord', async () => {
    const { rnsRegistry } = await loadFixture()

    // accounts[0] (deployer) owns the root node 0x0 in the fixture.
    await rnsRegistry.write.setSubnodeRecord([
      zeroHash,
      labelhash('rise'),
      accounts[1].address,
      placeholderAddr,
      3600n,
    ])

    await expect(
      rnsRegistry.read.owner([namehash('rise')]),
    ).resolves.toEqualAddress(accounts[1].address)
    await expect(
      rnsRegistry.read.resolver([namehash('rise')]),
    ).resolves.toEqual(placeholderAddr)
    await expect(rnsRegistry.read.ttl([namehash('rise')])).resolves.toEqual(
      3600n,
    )
  })

  it('should set owner, resolver and ttl via setRecord', async () => {
    const { rnsRegistry } = await loadFixture()

    // accounts[0] (deployer) owns the root node 0x0 in the fixture.
    await rnsRegistry.write.setRecord([
      zeroHash,
      accounts[1].address,
      placeholderAddr,
      7200n,
    ])

    await expect(rnsRegistry.read.owner([zeroHash])).resolves.toEqualAddress(
      accounts[1].address,
    )
    await expect(rnsRegistry.read.resolver([zeroHash])).resolves.toEqual(
      placeholderAddr,
    )
    await expect(rnsRegistry.read.ttl([zeroHash])).resolves.toEqual(7200n)
  })

  it('should allow an approved operator to mutate records', async () => {
    const { rnsRegistry } = await loadFixture()

    // accounts[0] (deployer) approves accounts[1] as a blanket operator.
    await expect(
      rnsRegistry.write.setApprovalForAll([accounts[1].address, true]),
    )
      .toEmitEvent('ApprovalForAll')
      .withArgs({
        owner: getAddress(accounts[0].address),
        operator: getAddress(accounts[1].address),
        approved: true,
      })

    await expect(
      rnsRegistry.read.isApprovedForAll([
        accounts[0].address,
        accounts[1].address,
      ]),
    ).resolves.toEqual(true)

    // The operator mutates accounts[0]'s root node 0x0.
    await expect(
      rnsRegistry.write.setSubnodeOwner(
        [zeroHash, labelhash('rise'), accounts[2].address],
        { account: accounts[1] },
      ),
    )
      .toEmitEvent('NewOwner')
      .withArgs({
        node: zeroHash,
        label: labelhash('rise'),
        owner: getAddress(accounts[2].address),
      })
    await expect(
      rnsRegistry.write.setResolver([zeroHash, secondResolver], {
        account: accounts[1],
      }),
    )
      .toEmitEvent('NewResolver')
      .withArgs({ node: zeroHash, resolver: secondResolver })
  })

  it('should reject a revoked operator', async () => {
    const { rnsRegistry } = await loadFixture()

    // Grant then revoke the operator.
    await rnsRegistry.write.setApprovalForAll([accounts[1].address, true])
    await rnsRegistry.write.setApprovalForAll([accounts[1].address, false])

    await expect(
      rnsRegistry.read.isApprovedForAll([
        accounts[0].address,
        accounts[1].address,
      ]),
    ).resolves.toEqual(false)

    // The revoked operator can no longer mutate accounts[0]'s nodes.
    await expect(
      rnsRegistry.write.setSubnodeOwner(
        [zeroHash, labelhash('rise'), accounts[2].address],
        { account: accounts[1] },
      ),
    ).toBeRevertedWithoutReason()
  })

  it('recordExists reflects whether a node has an owner', async () => {
    const { rnsRegistry } = await loadFixture()

    await expect(
      rnsRegistry.read.recordExists([namehash('rise')]),
    ).resolves.toEqual(false)

    await rnsRegistry.write.setSubnodeOwner([
      zeroHash,
      labelhash('rise'),
      accounts[1].address,
    ])

    await expect(
      rnsRegistry.read.recordExists([namehash('rise')]),
    ).resolves.toEqual(true)
  })
})

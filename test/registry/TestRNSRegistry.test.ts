import hre from 'hardhat'
import { getAddress, labelhash, namehash, padHex, zeroHash } from 'viem'

import { getAccounts } from '../fixtures/utils.js'

const placeholderAddr = padHex('0x1234', { size: 20 })

const connection = await hre.network.connect()
const accounts = await getAccounts(connection)

async function fixture() {
  const rnsRegistry = await connection.viem.deployContract('RNSRegistry', [])

  return { rnsRegistry }
}
const loadFixture = async () => connection.networkHelpers.loadFixture(fixture)

describe('RNSRegistry', () => {
  it('should allow ownership transfers', async () => {
    const { rnsRegistry } = await loadFixture()

    await expect(rnsRegistry.write.setOwner([zeroHash, placeholderAddr]))
      .toEmitEvent('Transfer')
      .withArgs({ node: zeroHash, owner: placeholderAddr })

    await expect(rnsRegistry.read.owner([zeroHash])).resolves.toEqual(
      placeholderAddr,
    )
  })
})

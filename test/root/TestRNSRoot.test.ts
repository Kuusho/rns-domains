import hre from 'hardhat'
import { labelhash, namehash, zeroHash } from 'viem'

import { getAccounts } from '../fixtures/utils.js'

const connection = await hre.network.connect()
const accounts = await getAccounts(connection)

async function fixture() {
  const rnsRegistry = await connection.viem.deployContract('RNSRegistry', [])
  const root = await connection.viem.deployContract('RNSRoot', [
    rnsRegistry.address,
  ])

  await root.write.setController([accounts[0].address, true])
  await rnsRegistry.write.setSubnodeOwner([
    zeroHash,
    labelhash('rise'),
    root.address,
  ])
  await rnsRegistry.write.setOwner([zeroHash, root.address])

  return { rnsRegistry, root, accounts }
}
const loadFixture = async () => connection.networkHelpers.loadFixture(fixture)

describe('RNSRoot', () => {
  describe('setSubnodeOwner', () => {
    it('should allow controllers to set subnodes', async () => {
      const { rnsRegistry, root, accounts } = await loadFixture()

      await root.write.setSubnodeOwner([labelhash('rise'), accounts[1].address])

      await expect(
        rnsRegistry.read.owner([namehash('rise')]),
      ).resolves.toEqualAddress(accounts[1].address)
    })

    it('should fail when non-controller tries to set subnode', async () => {
      const { root, accounts } = await loadFixture()

      await expect(
        root.write.setSubnodeOwner([labelhash('rise'), accounts[1].address], {
          account: accounts[1],
        }),
      ).toBeRevertedWithString('Controllable: Caller is not a controller')
    })

    it('should not allow setting a locked TLD', async () => {
      const { root, accounts } = await loadFixture()

      await root.write.lock([labelhash('rise')])

      await expect(
        root.write.setSubnodeOwner([labelhash('rise'), accounts[1].address]),
      ).toBeRevertedWithoutReason()
    })
  })
})

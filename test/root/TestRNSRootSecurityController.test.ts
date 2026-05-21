import { shouldSupportInterfaces } from '@ensdomains/hardhat-chai-matchers-viem/behaviour'
import hre from 'hardhat'
import { labelhash, namehash, zeroAddress, zeroHash } from 'viem'

import { getAccounts } from '../fixtures/utils.js'

const connection = await hre.network.connect()
const accounts = await getAccounts(connection)

async function fixture() {
  const rnsRegistry = await connection.viem.deployContract('RNSRegistry', [])
  const root = await connection.viem.deployContract('RNSRoot', [
    rnsRegistry.address,
  ])
  const rnsRootSecurityController = await connection.viem.deployContract(
    'RNSRootSecurityController',
    [root.address],
  )

  await rnsRegistry.write.setOwner([zeroHash, root.address])
  await root.write.setController([accounts[0].address, true])
  await root.write.setController([rnsRootSecurityController.address, true])

  return { rnsRegistry, root, rnsRootSecurityController, accounts }
}
const loadFixture = async () => connection.networkHelpers.loadFixture(fixture)

describe('RNSRootSecurityController', () => {
  shouldSupportInterfaces({
    contract: () => loadFixture().then((F) => F.rnsRootSecurityController),
    interfaces: ['IERC165'],
  })

  it('initializes root and rns references', async () => {
    const { rnsRegistry, root, rnsRootSecurityController } = await loadFixture()

    await expect(
      rnsRootSecurityController.read.root(),
    ).resolves.toEqualAddress(root.address)
    await expect(
      rnsRootSecurityController.read.rns(),
    ).resolves.toEqualAddress(rnsRegistry.address)
  })

  describe('disableTLD', () => {
    it('should take ownership and clear resolver', async () => {
      const { rnsRegistry, root, rnsRootSecurityController } =
        await loadFixture()
      const label = labelhash('rise')
      const node = namehash('rise')

      await root.write.setSubnodeOwner([label, accounts[0].address])
      await rnsRegistry.write.setResolver([node, accounts[1].address])

      await rnsRootSecurityController.write.disableTLD([label])

      await expect(rnsRegistry.read.owner([node])).resolves.toEqualAddress(
        rnsRootSecurityController.address,
      )
      await expect(
        rnsRegistry.read.resolver([node]),
      ).resolves.toEqualAddress(zeroAddress)
    })

    it('should revert when called by non-owner', async () => {
      const { rnsRootSecurityController } = await loadFixture()

      await expect(
        rnsRootSecurityController.write.disableTLD([labelhash('rise')], {
          account: accounts[1],
        }),
      ).toBeRevertedWithString('Ownable: caller is not the owner')
    })
  })
})

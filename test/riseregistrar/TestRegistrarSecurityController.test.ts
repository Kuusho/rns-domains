import { shouldSupportInterfaces } from '@ensdomains/hardhat-chai-matchers-viem/behaviour'
import hre from 'hardhat'
import { labelhash, namehash, zeroHash } from 'viem'

import { getAccounts } from '../fixtures/utils.js'

// Port of the reference ethregistrar TestRegistrarSecurityController suite.
// Renames applied per Phase-3 D-10 / D-11: ENS contract names swapped for RNS
// equivalents, TLD label and namehash strings swapped from the reference TLD
// to the rise TLD, ENS-prefixed variable names renamed to their RNS forms.
// The top-level describe stays un-prefixed per Phase 2 D-11 specifics (the
// registrar-side SC is part of the registrar layer, not RNS infrastructure —
// the reference itself doesn't prefix it).

const connection = await hre.network.connect()
const accounts = await getAccounts(connection)

async function fixture() {
  const rnsRegistry = await connection.viem.deployContract('RNSRegistry', [])
  const riseRegistrar = await connection.viem.deployContract('RiseRegistrar', [rnsRegistry.address, namehash('rise')])
  const registrarSecurityController = await connection.viem.deployContract('RegistrarSecurityController', [riseRegistrar.address])

  // Seat .rise on the registry so the registrar's `live` modifier passes
  // (root-mediated path lives in Plan 03-03's integration test).
  await rnsRegistry.write.setSubnodeOwner([
    zeroHash,
    labelhash('rise'),
    riseRegistrar.address,
  ])
  // Pitfall 4: hand registrar ownership to the SC so its forwarding methods
  // can call the registrar's onlyOwner-gated functions. Without this every
  // ported test reverts with the OZ v4 owner-check string.
  await riseRegistrar.write.transferOwnership([registrarSecurityController.address])

  return {
    rnsRegistry,
    riseRegistrar,
    registrarSecurityController,
  }
}
const loadFixture = async () => connection.networkHelpers.loadFixture(fixture)

describe('RegistrarSecurityController', () => {
  shouldSupportInterfaces({
    contract: () => loadFixture().then((F) => F.registrarSecurityController),
    interfaces: ['IERC165'],
  })

  it('initializes registrar reference', async () => {
    const { riseRegistrar, registrarSecurityController } = await loadFixture()
    await expect(
      registrarSecurityController.read.registrar(),
    ).resolves.toEqualAddress(riseRegistrar.address)
  })

  describe('disableRegistrarController', () => {
    it('should remove controller access', async () => {
      const { riseRegistrar, registrarSecurityController } =
        await loadFixture()
      const controller = accounts[1].address
      const securityController = accounts[2]

      await registrarSecurityController.write.addRegistrarController([
        controller,
      ])
      await registrarSecurityController.write.setController([
        securityController.address,
        true,
      ])

      await expect(
        riseRegistrar.read.controllers([controller]),
      ).resolves.toEqual(true)

      await registrarSecurityController.write.disableRegistrarController(
        [controller],
        { account: securityController },
      )

      await expect(
        riseRegistrar.read.controllers([controller]),
      ).resolves.toEqual(false)
    })

    it('should revert when called by non-controller', async () => {
      const { registrarSecurityController } = await loadFixture()
      await expect(
        registrarSecurityController.write.disableRegistrarController(
          [accounts[1].address],
          { account: accounts[1] },
        ),
      ).toBeRevertedWithString('Controllable: Caller is not a controller')
    })
  })

  describe('setRegistrarResolver', () => {
    it('should set the resolver for the base node', async () => {
      const { rnsRegistry, registrarSecurityController } = await loadFixture()
      const resolver = accounts[1].address

      await registrarSecurityController.write.setRegistrarResolver([resolver])

      await expect(
        rnsRegistry.read.resolver([namehash('rise')]),
      ).resolves.toEqualAddress(resolver)
    })

    it('should revert when called by non-owner', async () => {
      const { registrarSecurityController } = await loadFixture()
      await expect(
        registrarSecurityController.write.setRegistrarResolver(
          [accounts[1].address],
          { account: accounts[1] },
        ),
      ).toBeRevertedWithString('Ownable: caller is not the owner')
    })
  })

  describe('addRegistrarController', () => {
    it('should add registrar controller access', async () => {
      const { riseRegistrar, registrarSecurityController } = await loadFixture()
      const controller = accounts[1].address

      await registrarSecurityController.write.addRegistrarController([
        controller,
      ])

      await expect(
        riseRegistrar.read.controllers([controller]),
      ).resolves.toEqual(true)
    })

    it('should revert when called by non-owner', async () => {
      const { registrarSecurityController } = await loadFixture()
      await expect(
        registrarSecurityController.write.addRegistrarController(
          [accounts[1].address],
          { account: accounts[1] },
        ),
      ).toBeRevertedWithString('Ownable: caller is not the owner')
    })
  })

  describe('removeRegistrarController', () => {
    it('should remove registrar controller access', async () => {
      const { riseRegistrar, registrarSecurityController } = await loadFixture()
      const controller = accounts[1].address

      await registrarSecurityController.write.addRegistrarController([
        controller,
      ])
      await registrarSecurityController.write.removeRegistrarController([
        controller,
      ])

      await expect(
        riseRegistrar.read.controllers([controller]),
      ).resolves.toEqual(false)
    })

    it('should revert when called by non-owner', async () => {
      const { registrarSecurityController } = await loadFixture()
      await expect(
        registrarSecurityController.write.removeRegistrarController(
          [accounts[1].address],
          { account: accounts[1] },
        ),
      ).toBeRevertedWithString('Ownable: caller is not the owner')
    })
  })

  describe('transferRegistrarOwnership', () => {
    it('should transfer registrar ownership', async () => {
      const { riseRegistrar, registrarSecurityController } = await loadFixture()
      const newOwner = accounts[1].address
      await registrarSecurityController.write.transferRegistrarOwnership([
        newOwner,
      ])

      await expect(riseRegistrar.read.owner()).resolves.toEqualAddress(newOwner)
    })

    it('should revert when called by non-owner', async () => {
      const { registrarSecurityController } = await loadFixture()
      await expect(
        registrarSecurityController.write.transferRegistrarOwnership(
          [accounts[1].address],
          {
            account: accounts[1],
          },
        ),
      ).toBeRevertedWithString('Ownable: caller is not the owner')
    })
  })

})

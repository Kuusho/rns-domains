import hre from 'hardhat'
import { labelhash, namehash, zeroAddress, zeroHash } from 'viem'
import { toLabelId } from '../fixtures/utils.js'

// Port of the reference ethregistrar TestBaseRegistrar conformance suite.
// Renames applied per Phase-3 D-10 / D-11: ENS contract names swapped for RNS
// equivalents, TLD label and namehash strings swapped from the reference TLD
// to the rise TLD, ENS-prefixed variable names renamed to their RNS forms.
// Migration-event test omitted (D-09 — IRiseRegistrar does not declare it; the
// reference suite never tests it either). Test 11 keeps the exact OZ v4
// revert string — staying on OZ v4 (Claude's Discretion) is what keeps it green.

const connection = await hre.network.connect()
const publicClient = await connection.viem.getPublicClient()
const [ownerClient, controllerClient, registrantClient, otherClient] =
  await connection.viem.getWalletClients()
const ownerAccount = ownerClient.account
const controllerAccount = controllerClient.account
const registrantAccount = registrantClient.account
const otherAccount = otherClient.account

async function fixture() {
  const rnsRegistry = await connection.viem.deployContract('RNSRegistry', [])
  const riseRegistrar = await connection.viem.deployContract('RiseRegistrar', [rnsRegistry.address, namehash('rise')])

  await riseRegistrar.write.addController([controllerAccount.address])
  await rnsRegistry.write.setSubnodeOwner([
    zeroHash,
    labelhash('rise'),
    riseRegistrar.address,
  ])

  return { rnsRegistry, riseRegistrar }
}
const loadFixture = async () => connection.networkHelpers.loadFixture(fixture)

async function fixtureWithRegistration() {
  const existing = await loadFixture()
  await existing.riseRegistrar.write.register(
    [toLabelId('newname'), registrantAccount.address, 86400n],
    {
      account: controllerAccount,
    },
  )
  return existing
}
const loadFixtureWithRegistration = async () =>
  connection.networkHelpers.loadFixture(fixtureWithRegistration)

describe('RiseRegistrar', () => {
  it('should allow new registrations', async () => {
    const { rnsRegistry, riseRegistrar } = await loadFixture()

    const hash = await riseRegistrar.write.register(
      [toLabelId('newname'), registrantAccount.address, 86400n],
      {
        account: controllerAccount,
      },
    )
    const receipt = await publicClient.getTransactionReceipt({ hash })
    const block = await publicClient.getBlock({ blockHash: receipt.blockHash })

    await expect(
      rnsRegistry.read.owner([namehash('newname.rise')]),
    ).resolves.toEqualAddress(registrantAccount.address)
    await expect(
      riseRegistrar.read.ownerOf([toLabelId('newname')]),
    ).resolves.toEqualAddress(registrantAccount.address)
    await expect(
      riseRegistrar.read.nameExpires([toLabelId('newname')]),
    ).resolves.toEqual(block.timestamp + 86400n)
  })

  it('should allow registrations without updating the registry', async () => {
    const { rnsRegistry, riseRegistrar } = await loadFixture()

    const hash = await riseRegistrar.write.registerOnly(
      [toLabelId('silentname'), registrantAccount.address, 86400n],
      {
        account: controllerAccount,
      },
    )
    const receipt = await publicClient.getTransactionReceipt({ hash })
    const block = await publicClient.getBlock({ blockHash: receipt.blockHash })

    await expect(
      rnsRegistry.read.owner([namehash('silentname.rise')]),
    ).resolves.toEqualAddress(zeroAddress)
    await expect(
      riseRegistrar.read.ownerOf([toLabelId('silentname')]),
    ).resolves.toEqualAddress(registrantAccount.address)
    await expect(
      riseRegistrar.read.nameExpires([toLabelId('silentname')]),
    ).resolves.toEqual(block.timestamp + 86400n)
  })

  it('should allow renewals', async () => {
    const { riseRegistrar } = await loadFixtureWithRegistration()

    const oldExpires = await riseRegistrar.read.nameExpires([
      toLabelId('newname'),
    ])

    await riseRegistrar.write.renew([toLabelId('newname'), 86400n], {
      account: controllerAccount,
    })

    await expect(
      riseRegistrar.read.nameExpires([toLabelId('newname')]),
    ).resolves.toEqual(oldExpires + 86400n)
  })

  it('should only allow the controller to register', async () => {
    const { riseRegistrar } = await loadFixture()

    await expect(
      riseRegistrar.write.register(
        [toLabelId('foo'), otherAccount.address, 86400n],
        {
          account: otherAccount,
        },
      ),
    ).toBeRevertedWithoutReason()
  })

  it('should only allow the controller to renew', async () => {
    const { riseRegistrar } = await loadFixture()

    await expect(
      riseRegistrar.write.renew([toLabelId('foo'), 86400n], {
        account: otherAccount,
      }),
    ).toBeRevertedWithoutReason()
  })

  it('should not permit registration of already registered names', async () => {
    const { riseRegistrar } = await loadFixtureWithRegistration()

    await expect(
      riseRegistrar.write.register(
        [toLabelId('newname'), registrantAccount.address, 86400n],
        {
          account: controllerAccount,
        },
      ),
    ).toBeRevertedWithoutReason()
  })

  it('should not permit renewing a name that is not registered', async () => {
    const { riseRegistrar } = await loadFixture()

    await expect(
      riseRegistrar.write.renew([toLabelId('newname'), 86400n], {
        account: controllerAccount,
      }),
    ).toBeRevertedWithoutReason()
  })

  it('should permit the owner to reclaim a name', async () => {
    const { rnsRegistry, riseRegistrar } = await loadFixtureWithRegistration()

    await rnsRegistry.write.setOwner([namehash('newname.rise'), zeroAddress], {
      account: registrantAccount,
    })
    await riseRegistrar.write.reclaim(
      [toLabelId('newname'), registrantAccount.address],
      {
        account: registrantAccount,
      },
    )

    await expect(
      rnsRegistry.read.owner([namehash('newname.rise')]),
    ).resolves.toEqualAddress(registrantAccount.address)
  })

  it('should prohibit anyone else from reclaiming a name', async () => {
    const { rnsRegistry, riseRegistrar } = await loadFixtureWithRegistration()

    await rnsRegistry.write.setOwner([namehash('newname.rise'), zeroAddress], {
      account: registrantAccount,
    })

    await expect(
      riseRegistrar.write.reclaim(
        [toLabelId('newname'), registrantAccount.address],
        {
          account: otherAccount,
        },
      ),
    ).toBeRevertedWithoutReason()
  })

  it('should permit the owner to transfer a registration', async () => {
    const { rnsRegistry, riseRegistrar } = await loadFixtureWithRegistration()

    await riseRegistrar.write.transferFrom(
      [registrantAccount.address, otherAccount.address, toLabelId('newname')],
      {
        account: registrantAccount,
      },
    )

    await expect(
      riseRegistrar.read.ownerOf([toLabelId('newname')]),
    ).resolves.toEqualAddress(otherAccount.address)
    await expect(
      rnsRegistry.read.owner([namehash('newname.rise')]),
    ).resolves.toEqualAddress(registrantAccount.address)

    await riseRegistrar.write.transferFrom(
      [otherAccount.address, registrantAccount.address, toLabelId('newname')],
      {
        account: otherAccount,
      },
    )
  })

  it('should prohibit anyone else from transferring a registration', async () => {
    const { riseRegistrar } = await loadFixtureWithRegistration()

    await expect(
      riseRegistrar.write.transferFrom(
        [otherAccount.address, otherAccount.address, toLabelId('newname')],
        {
          account: otherAccount,
        },
      ),
    ).toBeRevertedWithString('ERC721: caller is not token owner or approved')
  })

  it('should not permit transfer or reclaim during the grace period', async () => {
    const { riseRegistrar } = await loadFixtureWithRegistration()
    const testClient = await connection.viem.getTestClient()

    await testClient.increaseTime({ seconds: 86400 + 3600 })
    await testClient.mine({ blocks: 1 })

    await expect(
      riseRegistrar.write.transferFrom(
        [registrantAccount.address, otherAccount.address, toLabelId('newname')],
        {
          account: registrantAccount,
        },
      ),
    ).toBeRevertedWithoutReason()

    await expect(
      riseRegistrar.write.reclaim(
        [toLabelId('newname'), registrantAccount.address],
        {
          account: registrantAccount,
        },
      ),
    ).toBeRevertedWithoutReason()
  })

  it('should allow renewal during the grace period', async () => {
    const { riseRegistrar } = await loadFixtureWithRegistration()
    const testClient = await connection.viem.getTestClient()

    await testClient.increaseTime({ seconds: 86400 + 3600 })
    await testClient.mine({ blocks: 1 })

    await riseRegistrar.write.renew([toLabelId('newname'), 86400n], {
      account: controllerAccount,
    })
  })

  it('should allow registration of an expired domain', async () => {
    const { riseRegistrar } = await loadFixtureWithRegistration()
    const testClient = await connection.viem.getTestClient()

    const gracePeriod = await riseRegistrar.read.GRACE_PERIOD()

    await testClient.increaseTime({
      seconds: 86400 + Number(gracePeriod) + 3600,
    })
    await testClient.mine({ blocks: 1 })

    await expect(
      riseRegistrar.read.ownerOf([toLabelId('newname')]),
    ).toBeRevertedWithoutReason()

    await riseRegistrar.write.register(
      [toLabelId('newname'), otherAccount.address, 86400n],
      {
        account: controllerAccount,
      },
    )

    await expect(
      riseRegistrar.read.ownerOf([toLabelId('newname')]),
    ).resolves.toEqualAddress(otherAccount.address)
  })

  it('should allow the owner to set a resolver address', async () => {
    const { rnsRegistry, riseRegistrar } = await loadFixture()

    await riseRegistrar.write.setResolver([controllerAccount.address], {
      account: ownerAccount,
    })

    await expect(
      rnsRegistry.read.resolver([namehash('rise')]),
    ).resolves.toEqualAddress(controllerAccount.address)
  })
})

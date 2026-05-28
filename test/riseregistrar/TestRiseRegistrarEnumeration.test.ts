import hre from 'hardhat'
import { labelhash, namehash, zeroHash } from 'viem'
import { toLabelId } from '../fixtures/utils.js'

// ENUM-01 + registrar-counter unit suite (Plan 08-01, Wave 0 RED → green at Tasks 1-2).
//
// Mirrors the hand-wired fixture from TestRiseRegistrar.test.ts EXACTLY: deploy
// RNSRegistry + RiseRegistrar (wired to own `.rise`), seat a controller. The
// surface under test (tokensOfOwner / registrations / renewals) does NOT exist
// until Task 1 lands ERC721Enumerable + the counters on the registrar — at Wave 0
// these blocks are EXPECTED to fail.
//
// `tokensOfOwner` reflects RAW ERC-721 ownership (D-02): an expired-but-not-burned
// name still appears under its last owner until re-registered (burn+remint). The
// counters increment at the canonical mint/renew chokepoints (D-03).

const connection = await hre.network.connect()
const [ownerClient, controllerClient, registrantClient, otherClient] =
  await connection.viem.getWalletClients()
const controllerAccount = controllerClient.account
const registrantAccount = registrantClient.account
const otherAccount = otherClient.account

const DURATION = 86400n // 1 day, mirrors the reference suite

async function fixture() {
  const rnsRegistry = await connection.viem.deployContract('RNSRegistry', [])
  const riseRegistrar = await connection.viem.deployContract('RiseRegistrar', [
    rnsRegistry.address,
    namehash('rise'),
  ])

  await riseRegistrar.write.addController([controllerAccount.address])
  await rnsRegistry.write.setSubnodeOwner([
    zeroHash,
    labelhash('rise'),
    riseRegistrar.address,
  ])

  return { rnsRegistry, riseRegistrar }
}
const loadFixture = async () => connection.networkHelpers.loadFixture(fixture)

// Travel past a name's expiry + GRACE_PERIOD so `available(id)` flips true and a
// re-registration burns+remints the token. Mirrors the reference suite's
// "registration of an expired domain" time-travel.
async function travelPastGracePeriod(riseRegistrar: {
  read: { GRACE_PERIOD: () => Promise<bigint> }
}) {
  const testClient = await connection.viem.getTestClient()
  const gracePeriod = await riseRegistrar.read.GRACE_PERIOD()
  await testClient.increaseTime({
    seconds: Number(DURATION) + Number(gracePeriod) + 3600,
  })
  await testClient.mine({ blocks: 1 })
}

// Travel just past a name's expiry (still inside the grace period) so the token
// is expired but NOT yet available for re-registration → it is NOT burned and
// must still enumerate under its last owner (raw ownership, D-02).
async function travelPastExpiryOnly() {
  const testClient = await connection.viem.getTestClient()
  await testClient.increaseTime({ seconds: Number(DURATION) + 3600 })
  await testClient.mine({ blocks: 1 })
}

describe('RiseRegistrar enumeration', () => {
  describe('tokensOfOwner', () => {
    it('after a single mint', async () => {
      const { riseRegistrar } = await loadFixture()

      await riseRegistrar.write.register(
        [toLabelId('alpha'), registrantAccount.address, DURATION],
        { account: controllerAccount },
      )

      await expect(
        riseRegistrar.read.tokensOfOwner([registrantAccount.address]),
      ).resolves.toEqual([toLabelId('alpha')])
      await expect(
        riseRegistrar.read.balanceOf([registrantAccount.address]),
      ).resolves.toBe(1n)
    })

    it('after multiple mints', async () => {
      const { riseRegistrar } = await loadFixture()

      await riseRegistrar.write.register(
        [toLabelId('alpha'), registrantAccount.address, DURATION],
        { account: controllerAccount },
      )
      await riseRegistrar.write.register(
        [toLabelId('beta'), registrantAccount.address, DURATION],
        { account: controllerAccount },
      )

      const ids = await riseRegistrar.read.tokensOfOwner([
        registrantAccount.address,
      ])
      expect(ids).toHaveLength(2)
      // order-insensitive containment
      expect([...ids].sort()).toEqual(
        [toLabelId('alpha'), toLabelId('beta')].sort(),
      )
    })

    it('after a transfer', async () => {
      const { riseRegistrar } = await loadFixture()

      await riseRegistrar.write.register(
        [toLabelId('alpha'), registrantAccount.address, DURATION],
        { account: controllerAccount },
      )
      await riseRegistrar.write.transferFrom(
        [registrantAccount.address, otherAccount.address, toLabelId('alpha')],
        { account: registrantAccount },
      )

      await expect(
        riseRegistrar.read.tokensOfOwner([registrantAccount.address]),
      ).resolves.toEqual([])
      await expect(
        riseRegistrar.read.tokensOfOwner([otherAccount.address]),
      ).resolves.toEqual([toLabelId('alpha')])
    })

    it('after burn+remint to a DIFFERENT owner', async () => {
      const { riseRegistrar } = await loadFixture()

      await riseRegistrar.write.register(
        [toLabelId('alpha'), registrantAccount.address, DURATION],
        { account: controllerAccount },
      )
      await travelPastGracePeriod(riseRegistrar)
      // name is now available again → re-register to `other` (burn+remint)
      await expect(
        riseRegistrar.read.available([toLabelId('alpha')]),
      ).resolves.toBe(true)
      await riseRegistrar.write.register(
        [toLabelId('alpha'), otherAccount.address, DURATION],
        { account: controllerAccount },
      )

      await expect(
        riseRegistrar.read.tokensOfOwner([registrantAccount.address]),
      ).resolves.toEqual([])
      await expect(
        riseRegistrar.read.tokensOfOwner([otherAccount.address]),
      ).resolves.toEqual([toLabelId('alpha')])
    })

    it('after burn+remint to the SAME owner', async () => {
      const { riseRegistrar } = await loadFixture()

      await riseRegistrar.write.register(
        [toLabelId('alpha'), registrantAccount.address, DURATION],
        { account: controllerAccount },
      )
      await travelPastGracePeriod(riseRegistrar)
      // re-register the lapsed name to the SAME owner (burn then remint)
      await riseRegistrar.write.register(
        [toLabelId('alpha'), registrantAccount.address, DURATION],
        { account: controllerAccount },
      )

      const ids = await riseRegistrar.read.tokensOfOwner([
        registrantAccount.address,
      ])
      expect(ids).toHaveLength(1)
      expect(ids).toEqual([toLabelId('alpha')]) // index net-unchanged
    })

    it('includes an expired-but-not-burned name (raw ownership, D-02)', async () => {
      const { riseRegistrar } = await loadFixture()

      await riseRegistrar.write.register(
        [toLabelId('alpha'), registrantAccount.address, DURATION],
        { account: controllerAccount },
      )
      // travel past expiry only (still in grace) → token NOT burned
      await travelPastExpiryOnly()

      // raw ERC-721 ownership: the lapsed name lingers under its last owner
      await expect(
        riseRegistrar.read.tokensOfOwner([registrantAccount.address]),
      ).resolves.toEqual([toLabelId('alpha')])

      // cross-check: it really is expired (nameExpires < now) yet still enumerated
      const expiry = await riseRegistrar.read.nameExpires([toLabelId('alpha')])
      const block = await (
        await connection.viem.getPublicClient()
      ).getBlock()
      expect(expiry).toBeLessThan(block.timestamp)
    })
  })

  describe('counters', () => {
    it('registrations increments per register, not on renew', async () => {
      const { riseRegistrar } = await loadFixture()

      await expect(riseRegistrar.read.registrations()).resolves.toBe(0n)

      await riseRegistrar.write.register(
        [toLabelId('alpha'), registrantAccount.address, DURATION],
        { account: controllerAccount },
      )
      await expect(riseRegistrar.read.registrations()).resolves.toBe(1n)

      await riseRegistrar.write.register(
        [toLabelId('beta'), registrantAccount.address, DURATION],
        { account: controllerAccount },
      )
      await expect(riseRegistrar.read.registrations()).resolves.toBe(2n)

      // a renew must NOT bump registrations
      await riseRegistrar.write.renew([toLabelId('alpha'), DURATION], {
        account: controllerAccount,
      })
      await expect(riseRegistrar.read.registrations()).resolves.toBe(2n)
    })

    it('registrations is unchanged on a reverted register', async () => {
      const { riseRegistrar } = await loadFixture()

      await riseRegistrar.write.register(
        [toLabelId('alpha'), registrantAccount.address, DURATION],
        { account: controllerAccount },
      )
      await expect(riseRegistrar.read.registrations()).resolves.toBe(1n)

      // re-register 'alpha' while still active → reverts via available() require
      await expect(
        riseRegistrar.write.register(
          [toLabelId('alpha'), registrantAccount.address, DURATION],
          { account: controllerAccount },
        ),
      ).toBeRevertedWithoutReason()

      // counter must be unchanged after the revert
      await expect(riseRegistrar.read.registrations()).resolves.toBe(1n)
    })

    it('renewals increments per renew', async () => {
      const { riseRegistrar } = await loadFixture()

      await expect(riseRegistrar.read.renewals()).resolves.toBe(0n)

      await riseRegistrar.write.register(
        [toLabelId('alpha'), registrantAccount.address, DURATION],
        { account: controllerAccount },
      )

      await riseRegistrar.write.renew([toLabelId('alpha'), DURATION], {
        account: controllerAccount,
      })
      await expect(riseRegistrar.read.renewals()).resolves.toBe(1n)

      await riseRegistrar.write.renew([toLabelId('alpha'), DURATION], {
        account: controllerAccount,
      })
      await expect(riseRegistrar.read.renewals()).resolves.toBe(2n)
    })

    it('registerOnly also increments registrations', async () => {
      const { riseRegistrar } = await loadFixture()

      await expect(riseRegistrar.read.registrations()).resolves.toBe(0n)

      await riseRegistrar.write.registerOnly(
        [toLabelId('gamma'), registrantAccount.address, DURATION],
        { account: controllerAccount },
      )
      await expect(riseRegistrar.read.registrations()).resolves.toBe(1n)
    })
  })

  describe('supportsInterface', () => {
    it('advertises IERC721Enumerable and keeps the ported ids', async () => {
      const { riseRegistrar } = await loadFixture()

      // 0x780e9d63 == type(IERC721Enumerable).interfaceId
      await expect(
        riseRegistrar.read.supportsInterface(['0x780e9d63']),
      ).resolves.toBe(true)
      // ERC-165 meta id
      await expect(
        riseRegistrar.read.supportsInterface(['0x01ffc9a7']),
      ).resolves.toBe(true)
      // ERC-721 id
      await expect(
        riseRegistrar.read.supportsInterface(['0x80ac58cd']),
      ).resolves.toBe(true)
      // a random id is not supported
      await expect(
        riseRegistrar.read.supportsInterface(['0xffffffff']),
      ).resolves.toBe(false)
    })
  })
})

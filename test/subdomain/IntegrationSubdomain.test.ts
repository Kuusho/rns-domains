import hre from 'hardhat'
import { labelhash, namehash, zeroAddress, type Hex } from 'viem'

import { loadAndExecuteDeployments } from '../../rocketh.js'
import { getAccounts } from '../fixtures/utils.js'
import { registerRiseName } from '../fixtures/registerRiseName.js'
import { configureSubdomain } from '../fixtures/configureSubdomain.js'

// Phase 7 (v1.1) — SubdomainRegistrar cross-contract integration suite (Plan
// 07-03, Wave 3). Runs the FULL Phase 1->7 deploy chain inline via the
// rocketh-in-test fixture (loadAndExecuteDeployments against the edr-simulated
// in-process provider), mirroring IntegrationRegistration.test.ts exactly. This
// exercises the live-wired behaviors the hand-wired unit suite (Plan 07-02)
// cannot:
//   * epoch (SUB-05 / Crit 4): a renewal of the parent keeps sold subdomains
//     active; an expire->re-register to a NEW owner invalidates them — asserted
//     on isActive / isSubnodeAvailable, NEVER on rns.owner(subnode) (A2 — the
//     invalidation is LOGICAL, not physical; the stale registry record persists).
//   * custody (SUB-07 / Crit 5): RiseRegistrar.ownerOf(parentId) stays the parent
//     owner across a subdomain sale; the registrar holds no parent token (it only
//     writes subnodes via rns.setSubnodeRecord under operator approval).
//   * stale (D-03): a plain ERC-721 transfer of the parent does NOT bump the epoch
//     (existing sold subdomains survive); once the new owner reclaims the registry
//     node, new sales revert StaleController until the new owner re-configures.
//
// `-t` filter tokens embedded in describe titles: epoch | custody | stale.
//
// Pattern 5 cast: connection.provider is cast to `never` to bypass EIP1193Provider
// strictness (mirrors hardhat-deploy's own wrapper). saveDeployments=false because
// the edr-simulated state is ephemeral.

const connection = await hre.network.connect()
const accounts = await getAccounts(connection)

// rocketh.ts namedAccounts: deployer = Hardhat index 0; owner = Hardhat index 1.
// Phase 6's controller transfers ownership to the named owner during deploy, so
// allowlist/endLaunch writes are signed by `owner`.
const owner = accounts[1]
const alice = accounts[2] // parent 2LD owner / listing controller
const bob = accounts[3] // subdomain buyer (epoch)
const carol = accounts[4] // re-registers the lapsed parent (epoch invalidation)
const dave = accounts[5] // subdomain buyer (custody)
const eve = accounts[6] // subdomain buyer (stale — existing sale that survives a plain transfer)
const frank = accounts[7] // acquires the parent ERC-721 + reclaims the registry node (stale)
const grace = accounts[8] // would-be buyer blocked by StaleController until re-configure (stale)

const ONE_YEAR = 365n * 86400n
const PRICE = 10n ** 16n // 0.01 RISE per subdomain

async function fixture() {
  // Run the full Phase 1-7 deploy chain inside the test process. All rocketh
  // scripts execute (Phase 2 registry+root -> Phase 3 registrar+SC -> Phase 4
  // resolvers -> Phase 5 price oracle -> Phase 6 reverse-registrars + controller
  // + activation gates -> Phase 7 subdomain registrar).
  const env = await loadAndExecuteDeployments({
    provider: connection.provider as never,
    network: connection.networkName,
    saveDeployments: false,
    askBeforeProceeding: false,
    logLevel: 0,
  })

  const rns = await connection.viem.getContractAt(
    'RNSRegistry',
    env.deployments.RNSRegistry.address as `0x${string}`,
  )
  const registrar = await connection.viem.getContractAt(
    'RiseRegistrar',
    env.deployments.RiseRegistrar.address as `0x${string}`,
  )
  const controller = await connection.viem.getContractAt(
    'RiseRegistrarController',
    env.deployments.RiseRegistrarController.address as `0x${string}`,
  )
  const subdomainRegistrar = await connection.viem.getContractAt(
    'SubdomainRegistrar',
    env.deployments.SubdomainRegistrar.address as `0x${string}`,
  )

  return { rns, registrar, controller, subdomainRegistrar }
}
const loadFixture = async () => connection.networkHelpers.loadFixture(fixture)

/**
 * Register a parent 2LD `<label>.rise` to `ownerAccount` via the deployed
 * RiseRegistrarController commit->wait->register flow. Allowlists the registrant
 * first (launchActive defaults true at deploy). Returns the namehash/labelhash/id
 * triple the SubdomainRegistrar keys on.
 */
async function registerParent(
  controller: Awaited<ReturnType<typeof fixture>>['controller'],
  label: string,
  ownerAccount: { address: `0x${string}` },
) {
  await controller.write.setAllowlisted([ownerAccount.address, true], {
    account: owner,
  })
  await registerRiseName(
    controller,
    connection.networkHelpers,
    { label, ownerAddress: ownerAccount.address, duration: ONE_YEAR },
    { caller: ownerAccount },
  )
  return {
    parentNode: namehash(`${label}.rise`) as Hex,
    parentLabelHash: labelhash(label) as Hex,
    parentId: BigInt(labelhash(label)),
  }
}

describe('IntegrationSubdomain (Phase 7 — full-chain cross-contract gate)', () => {
  // ────────────────────────────────────────────────────────────────────────
  // SUB-05 / Crit 4 — the headline epoch behavior.
  // ────────────────────────────────────────────────────────────────────────
  describe('epoch', () => {
    it('SUB-05: renewal keeps subdomains active; expire+re-register to a new owner invalidates them (isActive, A2 — NOT rns.owner(subnode))', async () => {
      const { rns, registrar, controller, subdomainRegistrar } =
        await loadFixture()

      // (1) Register the parent alice.rise, list it, and sell `bob` a subdomain.
      const { parentNode, parentLabelHash, parentId } = await registerParent(
        controller,
        'alice',
        alice,
      )
      await configureSubdomain(subdomainRegistrar, rns, {
        parentNode,
        parentLabelHash,
        payout: alice.address,
        price: PRICE,
        parentOwner: alice,
      })
      const bobLabel = labelhash('bob') as Hex
      await subdomainRegistrar.write.register([parentNode, 'bob', bob.address], {
        value: PRICE,
        account: bob,
      })

      // Sold + epoch-current => active; the subnode is no longer available.
      await expect(
        subdomainRegistrar.read.isActive([parentNode, bobLabel]),
      ).resolves.toBe(true)
      await expect(
        subdomainRegistrar.read.isSubnodeAvailable([parentNode, bobLabel]),
      ).resolves.toBe(false)
      // The registry subnode is owned by the buyer (live-wired setSubnodeRecord).
      await expect(
        rns.read.owner([namehash('bob.alice.rise')]),
      ).resolves.toEqualAddress(bob.address)

      // (2) RENEWAL survives — a plain renew extends the parent's expiry but does
      // NOT change rns.owner(parentNode); the owner-snapshot + `>=` tuple keeps
      // bob active (Pitfall 1 — renewal must NOT invalidate).
      const oldExpiry = await registrar.read.nameExpires([parentId])
      const renewPrice = await controller.read.rentPrice(['alice', ONE_YEAR])
      await controller.write.renew(['alice', ONE_YEAR, ('0x' + '0'.repeat(64)) as Hex], {
        value: renewPrice.base + renewPrice.premium,
        account: alice,
      })
      const newExpiry = await registrar.read.nameExpires([parentId])
      expect(newExpiry).toBe(oldExpiry + ONE_YEAR)
      await expect(
        subdomainRegistrar.read.isActive([parentNode, bobLabel]),
      ).resolves.toBe(true) // STILL active after renewal

      // (3) RE-REGISTRATION invalidates — time-travel past expiry + GRACE_PERIOD
      // so the parent is available, then re-register alice.rise to a DIFFERENT
      // owner (carol) via the controller. rns.owner(parentNode) flips to carol,
      // breaking bob's parentOwnerSnapshot -> isActive reads false, the subnode
      // becomes re-sellable.
      const gracePeriod = await registrar.read.GRACE_PERIOD()
      const expiryNow = await registrar.read.nameExpires([parentId])
      const block = await (
        await connection.viem.getPublicClient()
      ).getBlock()
      const secondsToAvailable =
        Number(expiryNow - block.timestamp) + Number(gracePeriod) + 60
      await connection.networkHelpers.time.increase(secondsToAvailable)
      await expect(registrar.read.available([parentId])).resolves.toBe(true)

      await registerParent(controller, 'alice', carol)
      await expect(
        rns.read.owner([namehash('alice.rise')]),
      ).resolves.toEqualAddress(carol.address)

      // A2 — assert on the LOGICAL views, never on rns.owner(subnode).
      await expect(
        subdomainRegistrar.read.isActive([parentNode, bobLabel]),
      ).resolves.toBe(false) // epoch-invalidated
      await expect(
        subdomainRegistrar.read.isSubnodeAvailable([parentNode, bobLabel]),
      ).resolves.toBe(true) // re-sellable by the new parent owner
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // SUB-07 / Crit 5 — no custody: the registrar never holds the parent token.
  // ────────────────────────────────────────────────────────────────────────
  describe('custody', () => {
    it('SUB-07: RiseRegistrar.ownerOf(parentId) stays the parent owner across a sale; registrar holds no token (operator-approval write only)', async () => {
      const { rns, registrar, controller, subdomainRegistrar } =
        await loadFixture()

      const { parentNode, parentLabelHash, parentId } = await registerParent(
        controller,
        'alice',
        alice,
      )

      // Before any sale: the parent ERC-721 is held by alice, not the registrar.
      await expect(
        registrar.read.ownerOf([parentId]),
      ).resolves.toEqualAddress(alice.address)

      await configureSubdomain(subdomainRegistrar, rns, {
        parentNode,
        parentLabelHash,
        payout: alice.address,
        price: PRICE,
        parentOwner: alice,
      })
      await subdomainRegistrar.write.register(
        [parentNode, 'dave', dave.address],
        { value: PRICE, account: dave },
      )

      // After the sale: the parent ERC-721 STILL belongs to alice — the registrar
      // never took custody (no transferFrom of the parent token).
      await expect(
        registrar.read.ownerOf([parentId]),
      ).resolves.toEqualAddress(alice.address)
      // And it is NEVER the SubdomainRegistrar.
      const parentTokenOwner = await registrar.read.ownerOf([parentId])
      expect(parentTokenOwner.toLowerCase()).not.toBe(
        subdomainRegistrar.address.toLowerCase(),
      )
      // The only write the registrar performed was the subnode record under
      // operator approval: dave owns dave.alice.rise in the registry.
      await expect(
        rns.read.owner([namehash('dave.alice.rise')]),
      ).resolves.toEqualAddress(dave.address)
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // D-03 — StaleController guard on a silent parent transfer.
  // ────────────────────────────────────────────────────────────────────────
  describe('stale', () => {
    it('D-03: a plain transfer keeps existing sales active; a registry-owner change reverts new register StaleController until the new owner re-configures', async () => {
      const { rns, registrar, controller, subdomainRegistrar } =
        await loadFixture()

      // Parent listed by alice; sell `eve` a subdomain first.
      const { parentNode, parentLabelHash, parentId } = await registerParent(
        controller,
        'alice',
        alice,
      )
      await configureSubdomain(subdomainRegistrar, rns, {
        parentNode,
        parentLabelHash,
        payout: alice.address,
        price: PRICE,
        parentOwner: alice,
      })
      const eveLabel = labelhash('eve') as Hex
      await subdomainRegistrar.write.register([parentNode, 'eve', eve.address], {
        value: PRICE,
        account: eve,
      })
      await expect(
        subdomainRegistrar.read.isActive([parentNode, eveLabel]),
      ).resolves.toBe(true)

      // (b) PLAIN ERC-721 transfer of the parent to frank. This moves the token
      // but does NOT update rns.owner(parentNode) (the registry node is only
      // changed by reclaim/register). The epoch does NOT bump on a plain
      // transfer, so eve's existing sale SURVIVES — isActive stays true.
      await registrar.write.transferFrom(
        [alice.address, frank.address, parentId],
        { account: alice },
      )
      await expect(
        registrar.read.ownerOf([parentId]),
      ).resolves.toEqualAddress(frank.address)
      await expect(
        rns.read.owner([parentNode]),
      ).resolves.toEqualAddress(alice.address) // registry node still alice (silent)
      await expect(
        subdomainRegistrar.read.isActive([parentNode, eveLabel]),
      ).resolves.toBe(true) // D-03: existing sale survives a plain transfer

      // (a) frank reclaims the registry node so rns.owner(parentNode) == frank.
      // Now the stored config.controller (== alice at configure time) no longer
      // matches the current registry owner: a NEW register reverts StaleController.
      await registrar.write.reclaim([parentId, frank.address], {
        account: frank,
      })
      await expect(
        rns.read.owner([parentNode]),
      ).resolves.toEqualAddress(frank.address)
      await expect(
        subdomainRegistrar.write.register(
          [parentNode, 'grace', grace.address],
          { value: PRICE, account: grace },
        ),
      ).toBeRevertedWithCustomError('StaleController')

      // (c) frank re-onboards: setApprovalForAll + configure again (re-snapshots
      // config.controller = frank), and the sale resumes.
      await configureSubdomain(subdomainRegistrar, rns, {
        parentNode,
        parentLabelHash,
        payout: frank.address,
        price: PRICE,
        parentOwner: frank,
      })
      await subdomainRegistrar.write.register(
        [parentNode, 'grace', grace.address],
        { value: PRICE, account: grace },
      )
      await expect(
        rns.read.owner([namehash('grace.alice.rise')]),
      ).resolves.toEqualAddress(grace.address)
    })
  })
})

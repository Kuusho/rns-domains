import hre from 'hardhat'
import { labelhash, namehash, type Hex } from 'viem'

import { loadAndExecuteDeployments } from '../../rocketh.js'
import { getAccounts } from '../fixtures/utils.js'
import { registerRiseName } from '../fixtures/registerRiseName.js'
import { configureSubdomain } from '../fixtures/configureSubdomain.js'

// Phase 8 (v1.1) — RiseStats full-chain aggregator-consistency suite (Plan 08-04,
// Wave 2). Runs the FULL Phase 1->8 deploy chain inline via the rocketh-in-test
// fixture (loadAndExecuteDeployments against the edr-simulated in-process
// provider), mirroring IntegrationSubdomain.test.ts exactly.
//
// RiseStats is a pure read aggregator (ENUM-02 / D-05): stats() returns the four
// global counters (+ live currentSupply) in one call. This suite drives each
// source counter (register / renew / subdomain-sale) and asserts the aggregate
// reflects it, and proves Pitfall 7 — stats() never reverts even when an expired
// (un-burned) name lingers, because the aggregator reads ONLY plain public
// counters, never ownerOf / nameExpires.
//
// `-t` filter token embedded in describe title: stats.
//
// Pattern 5 cast: connection.provider is cast to `never` to bypass EIP1193Provider
// strictness (mirrors hardhat-deploy's own wrapper). saveDeployments=false because
// the edr-simulated state is ephemeral. Per-suite the repo's vitest.config.ts now
// carries a 120s global timeout, so the full-chain fixture will not time out.

const connection = await hre.network.connect()
const accounts = await getAccounts(connection)

// rocketh.ts namedAccounts: deployer = Hardhat index 0; owner = Hardhat index 1.
// Phase 6's controller transfers ownership to the named owner during deploy, so
// allowlist writes are signed by `owner`.
const owner = accounts[1]
const alice = accounts[2] // parent 2LD owner / listing controller
const bob = accounts[3] // subdomain buyer
const carol = accounts[4] // buyer of a separate name (currentSupply / Pitfall 7)

const ONE_YEAR = 365n * 86400n
const SUB_PRICE = 10n ** 16n // 0.01 RISE per subdomain

async function fixture() {
  // Run the full Phase 1-8 deploy chain inside the test process. All rocketh
  // scripts execute (Phase 2 registry+root -> Phase 3 registrar+SC -> Phase 4
  // resolvers -> Phase 5 price oracle -> Phase 6 reverse-registrars + controller
  // + activation gates -> Phase 7 subdomain registrar -> Phase 8 stats).
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
  const riseStats = await connection.viem.getContractAt(
    'RiseStats',
    env.deployments.RiseStats.address as `0x${string}`,
  )

  return { rns, registrar, controller, subdomainRegistrar, riseStats }
}
const loadFixture = async () => connection.networkHelpers.loadFixture(fixture)

/**
 * Register a parent 2LD `<label>.rise` to `ownerAccount` via the deployed
 * RiseRegistrarController commit->wait->register flow. Allowlists the registrant
 * first (launchActive defaults true at deploy). Returns the namehash/labelhash/id
 * triple plus the total price paid (the amount cumulativeVolume moves by).
 */
async function registerParent(
  ctx: Awaited<ReturnType<typeof fixture>>,
  label: string,
  ownerAccount: { address: `0x${string}` },
) {
  const { controller } = ctx
  await controller.write.setAllowlisted([ownerAccount.address, true], {
    account: owner,
  })
  const price = await controller.read.rentPrice([label, ONE_YEAR])
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
    totalPrice: price.base + price.premium, // == cumulativeVolume delta for a register
  }
}

describe('RiseStats (Phase 8 — full-chain aggregator-consistency gate) [stats]', () => {
  // ────────────────────────────────────────────────────────────────────────
  // Baseline — stats() mirrors every source getter at chain start.
  // ────────────────────────────────────────────────────────────────────────
  it('stats() reflects the source counters after a baseline [stats]', async () => {
    const { registrar, controller, subdomainRegistrar, riseStats } =
      await loadFixture()

    const s = await riseStats.read.stats()

    await expect(registrar.read.registrations()).resolves.toBe(s.registrations)
    await expect(registrar.read.renewals()).resolves.toBe(s.renewals)
    await expect(
      subdomainRegistrar.read.totalSubdomains(),
    ).resolves.toBe(s.totalSubdomains)
    await expect(controller.read.cumulativeVolume()).resolves.toBe(
      s.cumulativeVolume,
    )
    await expect(registrar.read.totalSupply()).resolves.toBe(s.currentSupply)
  })

  // ────────────────────────────────────────────────────────────────────────
  // registrations + currentSupply + cumulativeVolume all move on a register.
  // ────────────────────────────────────────────────────────────────────────
  it('registrations increment propagates to stats() [stats]', async () => {
    const ctx = await loadFixture()
    const { riseStats } = ctx

    const before = await riseStats.read.stats()
    const { totalPrice } = await registerParent(ctx, 'alice', alice)
    const after = await riseStats.read.stats()

    expect(after.registrations).toBe(before.registrations + 1n)
    expect(after.currentSupply).toBe(before.currentSupply + 1n)
    expect(after.cumulativeVolume).toBe(before.cumulativeVolume + totalPrice)
  })

  // ────────────────────────────────────────────────────────────────────────
  // renewals + cumulativeVolume move on a renew (cumulativeVolume += price.base).
  // ────────────────────────────────────────────────────────────────────────
  it('renewals increment propagates to stats() [stats]', async () => {
    const ctx = await loadFixture()
    const { controller, riseStats } = ctx

    await registerParent(ctx, 'alice', alice)

    const before = await riseStats.read.stats()
    const renewPrice = await controller.read.rentPrice(['alice', ONE_YEAR])
    await controller.write.renew(
      ['alice', ONE_YEAR, ('0x' + '0'.repeat(64)) as Hex],
      { value: renewPrice.base + renewPrice.premium, account: alice },
    )
    const after = await riseStats.read.stats()

    expect(after.renewals).toBe(before.renewals + 1n)
    // Controller credits the PRICED base of the renewal (cumulativeVolume += price.base).
    expect(after.cumulativeVolume).toBe(before.cumulativeVolume + renewPrice.base)
  })

  // ────────────────────────────────────────────────────────────────────────
  // totalSubdomains moves on a subdomain sale under a registered parent.
  // ────────────────────────────────────────────────────────────────────────
  it('totalSubdomains increment propagates to stats() [stats]', async () => {
    const ctx = await loadFixture()
    const { rns, subdomainRegistrar, riseStats } = ctx

    const { parentNode, parentLabelHash } = await registerParent(
      ctx,
      'alice',
      alice,
    )
    await configureSubdomain(subdomainRegistrar, rns, {
      parentNode,
      parentLabelHash,
      payout: alice.address,
      price: SUB_PRICE,
      parentOwner: alice,
    })

    const before = await riseStats.read.stats()
    await subdomainRegistrar.write.register([parentNode, 'bob', bob.address], {
      value: SUB_PRICE,
      account: bob,
    })
    const after = await riseStats.read.stats()

    expect(after.totalSubdomains).toBe(before.totalSubdomains + 1n)
  })

  // ────────────────────────────────────────────────────────────────────────
  // Pitfall 7 — stats() never reverts even when an expired (un-burned) name
  // lingers. Proves the aggregator reads only plain counters, never ownerOf.
  // ────────────────────────────────────────────────────────────────────────
  it('stats() does not revert when an expired name exists (Pitfall 7) [stats]', async () => {
    const ctx = await loadFixture()
    const { registrar, riseStats } = ctx

    const { parentId } = await registerParent(ctx, 'carol', carol)

    // currentSupply counts the freshly-minted token.
    const supplyAtMint = (await riseStats.read.stats()).currentSupply
    expect(supplyAtMint).toBeGreaterThan(0n)

    // Time-travel PAST expiry + GRACE_PERIOD so the name is fully expired — but do
    // NOT re-register or burn it. ownerOf(parentId) now reverts ("expired"), yet
    // the token is still un-burned so ERC721Enumerable.totalSupply() still counts it.
    const gracePeriod = await registrar.read.GRACE_PERIOD()
    const expiryNow = await registrar.read.nameExpires([parentId])
    const block = await (await connection.viem.getPublicClient()).getBlock()
    const secondsToExpire =
      Number(expiryNow - block.timestamp) + Number(gracePeriod) + 60
    await connection.networkHelpers.time.increase(secondsToExpire)
    await expect(registrar.read.available([parentId])).resolves.toBe(true)

    // The reverting getter is real — ownerOf on the expired token reverts.
    await expect(registrar.read.ownerOf([parentId])).rejects.toThrow()

    // RiseStats reads ONLY plain counters, so stats() resolves cleanly and
    // currentSupply STILL counts the un-burned token (D-02 — raw enumeration).
    const s = await riseStats.read.stats()
    expect(s.currentSupply).toBe(supplyAtMint)
  })
})

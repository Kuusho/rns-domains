import hre from 'hardhat'
import { type Address, namehash, zeroAddress } from 'viem'

import { loadAndExecuteDeployments } from '../../rocketh.js'
import { getAccounts, toLabelId } from '../fixtures/utils.js'

// Phase 4 integration suite — closes RES-07 end-to-end via the rocketh-in-test
// fixture pattern established by Phase 3's TestRiseTLDIntegration.test.ts
// (D-14 + Phase 3 RESEARCH Pattern 5). Runs the FULL Phase 1+2+3+4 deploy
// chain against the in-process edr-simulated provider so the activation gates
// — Phase 3's TLD-01 (registrar owns .rise) and Phase 4's RES-07
// (RiseOwnedResolver is the .rise node's resolver) — are exercised exactly
// as production deploys will.
//
// Five tests:
//   1. RES-07: rnsRegistry.resolver(namehash('rise')) == RiseOwnedResolver.address
//   2. D-01: PublicResolver was deployed with both trusted slots at address(0)
//   3. Deploy-script ownership transfer: PublicResolver.owner() == named `owner`
//   4. Deploy-script ownership transfer: RiseOwnedResolver.owner() == named `owner`
//   5. End-to-end: register alice.rise → assign PublicResolver to alice.rise →
//      set addr + text records on alice via PublicResolver → read back. Exercises
//      every Phase 1-4 contract through one cohesive scenario.
//
// Pattern 5 cast: connection.provider is cast to `never` to bypass the
// EIP1193Provider type strictness, mirroring hardhat-deploy's own wrapper.
// saveDeployments=false because the edr-simulated state is ephemeral.

const connection = await hre.network.connect()
const accounts = await getAccounts(connection)

async function fixture() {
  // Run the full Phase 1+2+3+4 deploy chain inside the test process.
  const env = await loadAndExecuteDeployments({
    provider: connection.provider as never,
    network: connection.networkName,
    saveDeployments: false,
    askBeforeProceeding: false,
    logLevel: 0,
  })

  const rnsRegistry = await connection.viem.getContractAt(
    'RNSRegistry',
    env.deployments.RNSRegistry.address as `0x${string}`,
  )
  const riseRegistrar = await connection.viem.getContractAt(
    'RiseRegistrar',
    env.deployments.RiseRegistrar.address as `0x${string}`,
  )
  const securityController = await connection.viem.getContractAt(
    'RegistrarSecurityController',
    env.deployments.RegistrarSecurityController.address as `0x${string}`,
  )
  const publicResolver = await connection.viem.getContractAt(
    'PublicResolver',
    env.deployments.PublicResolver.address as `0x${string}`,
  )
  const riseOwnedResolver = await connection.viem.getContractAt(
    'RiseOwnedResolver',
    env.deployments.RiseOwnedResolver.address as `0x${string}`,
  )

  return {
    rnsRegistry,
    riseRegistrar,
    securityController,
    publicResolver,
    riseOwnedResolver,
  }
}
const loadFixture = async () => connection.networkHelpers.loadFixture(fixture)

// rocketh.ts namedAccounts: `deployer` = Hardhat index 0 (unused in this suite
// — the integration test only asserts post-deploy state); `owner` = Hardhat
// index 1 (the SC's Ownable owner per Phase 3 setup; also the
// PublicResolver/RiseOwnedResolver owner per the Phase 4 deploy scripts).
const owner = accounts[1]
const alice = accounts[3]

describe('IntegrationResolution', () => {
  it('RES-07: .rise node resolver is RiseOwnedResolver after activation', async () => {
    const { rnsRegistry, riseOwnedResolver } = await loadFixture()
    await expect(
      rnsRegistry.read.resolver([namehash('rise')]),
    ).resolves.toEqualAddress(riseOwnedResolver.address)
  })

  it('PublicResolver was deployed with both trusted slots at address(0) (D-01)', async () => {
    const { publicResolver } = await loadFixture()
    await expect(
      publicResolver.read.trustedRiseController(),
    ).resolves.toEqualAddress(zeroAddress)
    await expect(
      publicResolver.read.trustedReverseRegistrar(),
    ).resolves.toEqualAddress(zeroAddress)
  })

  it('PublicResolver.owner() == named owner account (deploy script transferred ownership)', async () => {
    const { publicResolver } = await loadFixture()
    await expect(publicResolver.read.owner()).resolves.toEqualAddress(
      owner.address,
    )
  })

  it('RiseOwnedResolver.owner() == named owner account (deploy script transferred ownership)', async () => {
    const { riseOwnedResolver } = await loadFixture()
    await expect(riseOwnedResolver.read.owner()).resolves.toEqualAddress(
      owner.address,
    )
  })

  it('end-to-end: register alice.rise → assign PublicResolver → setAddr/setText → read back', async () => {
    const {
      rnsRegistry,
      riseRegistrar,
      securityController,
      publicResolver,
    } = await loadFixture()

    // 1. Add `owner` as a registrar controller via the SC. SC.addRegistrarController
    //    is onlyOwner; the SC's owner is the named `owner` account per Phase 3
    //    00_deploy_registrar_security_controller.ts. Using `owner` both as the
    //    SC-owner caller AND as the controller keeps the test minimal — once
    //    added, `owner` can call RiseRegistrar.register directly.
    await securityController.write.addRegistrarController([owner.address], {
      account: owner,
    })

    // 2. Register `alice.rise` to alice for 1 year. RiseRegistrar.register
    //    signature: register(uint256 id, address owner, uint256 duration).
    const label = 'alice'
    const labelId = toLabelId(label)
    const duration = 365n * 24n * 60n * 60n
    await riseRegistrar.write.register([labelId, alice.address, duration], {
      account: owner,
    })

    // 3. Alice (now the registry-side owner of alice.rise per RNS.setSubnodeOwner
    //    inside RiseRegistrar._register) assigns PublicResolver as the resolver
    //    for `alice.rise`.
    const aliceNode = namehash('alice.rise')
    await rnsRegistry.write.setResolver(
      [aliceNode, publicResolver.address],
      { account: alice },
    )

    // 4. Alice writes records on PublicResolver. Both setX paths go through
    //    ResolverBase.authorised(node) which evaluates the 5-source check;
    //    alice is the rns.owner of alice.rise → authorised.
    await publicResolver.write.setAddr([aliceNode, alice.address], {
      account: alice,
    })
    await publicResolver.write.setText(
      [aliceNode, 'url', 'https://alice.rise'],
      { account: alice },
    )

    // 5. Read back. The legacy `addr(bytes32)` overload is disambiguated via a
    //    Promise<Address> cast — the same pattern used in TestPublicResolver.
    //    The bracket-notation `read['addr(bytes32)']` form is not surfaced by
    //    viem because the ABI exposes the overloads under the same `addr` key.
    await expect(
      publicResolver.read.addr([aliceNode]) as Promise<Address>,
    ).resolves.toEqualAddress(alice.address)
    await expect(publicResolver.read.text([aliceNode, 'url'])).resolves.toBe(
      'https://alice.rise',
    )
  })
})

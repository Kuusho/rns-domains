import hre from 'hardhat'
import { namehash } from 'viem'

import { loadAndExecuteDeployments } from '../../rocketh.js'
import { getAccounts, toLabelId } from '../fixtures/utils.js'

// RNS-original integration suite (D-13). FIRST test in the project to invoke
// the rocketh deploy harness inline via loadAndExecuteDeployments (D-14 +
// RESEARCH Pattern 5 — "no precedent fixture to copy"). Runs the full Phase
// 1 + 2 + 3 deploy chain against the in-process edr-simulated provider so
// the activation gate (D-02) is exercised end-to-end through Root rather
// than the registry-only shortcut used by the conformance suite fixtures.
//
// Closes the TLD-01 gap the reference ENS suites do not cover: the upstream
// fixtures seat the registrar by calling setSubnodeOwner on the registry
// directly, bypassing Root. This file proves TLD-01 by routing through
// RNSRoot.setSubnodeOwner exactly as production deploys will.
//
// Pattern 5 cast: connection.provider is cast to `never` to bypass the
// EIP1193Provider type strictness, mirroring hardhat-deploy's own wrapper
// (node_modules/hardhat-deploy/dist/esm/tasks/deploy.js line 17 — TODO type).
// saveDeployments=false because the edr-simulated state is ephemeral.

const connection = await hre.network.connect()
const accounts = await getAccounts(connection)

async function fixture() {
  // Run the full Phase 1 + 2 + 3 deploy chain inside the test process.
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
  const root = await connection.viem.getContractAt(
    'RNSRoot',
    env.deployments.RNSRoot.address as `0x${string}`,
  )
  const riseRegistrar = await connection.viem.getContractAt(
    'RiseRegistrar',
    env.deployments.RiseRegistrar.address as `0x${string}`,
  )
  const registrarSecurityController = await connection.viem.getContractAt(
    'RegistrarSecurityController',
    env.deployments.RegistrarSecurityController.address as `0x${string}`,
  )

  return { rnsRegistry, root, riseRegistrar, registrarSecurityController }
}
const loadFixture = async () => connection.networkHelpers.loadFixture(fixture)

describe('RiseTLDIntegration', () => {
  it('TLD-01: registry assigns .rise node to RiseRegistrar after activation gate', async () => {
    const { rnsRegistry, riseRegistrar } = await loadFixture()
    await expect(
      rnsRegistry.read.owner([namehash('rise')]),
    ).resolves.toEqualAddress(riseRegistrar.address)
  })

  it('TLD-01 (functional): controller can register a .rise name through the activated registrar', async () => {
    const { rnsRegistry, riseRegistrar, registrarSecurityController } =
      await loadFixture()
    const owner = accounts[1] // SC owner per rocketh.ts namedAccounts (owner = index 1)
    const controller = accounts[2] // authorised as a registrar controller via the SC
    const registrant = accounts[3] // the .rise name buyer

    // Owner authorises a controller via the SC. The SC must be the registrar's
    // owner (set in 00_setup_rise_registrar.ts step 3a) — and the SC's owner
    // must be `owner` (set in 00_deploy_registrar_security_controller.ts).
    await registrarSecurityController.write.addRegistrarController(
      [controller.address],
      { account: owner },
    )

    // The authorised controller registers 'alice' for 1 day.
    await riseRegistrar.write.register(
      [toLabelId('alice'), registrant.address, 86400n],
      { account: controller },
    )

    // ERC-721 ownership recorded.
    await expect(
      riseRegistrar.read.ownerOf([toLabelId('alice')]),
    ).resolves.toEqualAddress(registrant.address)

    // Registry round-trip — proves the registrar's setSubnodeOwner via the
    // .rise node worked, which it can ONLY do if it owns .rise (the activation
    // gate's contract).
    await expect(
      rnsRegistry.read.owner([namehash('alice.rise')]),
    ).resolves.toEqualAddress(registrant.address)
  })

  it('activation gate transferred RiseRegistrar ownership to the SC', async () => {
    const { riseRegistrar, registrarSecurityController } = await loadFixture()
    await expect(riseRegistrar.read.owner()).resolves.toEqualAddress(
      registrarSecurityController.address,
    )
  })

  it('RegistrarSecurityController.owner() == namedAccounts.owner (D-14 two-account handoff)', async () => {
    const { registrarSecurityController } = await loadFixture()
    await expect(
      registrarSecurityController.read.owner(),
    ).resolves.toEqualAddress(accounts[1].address)
  })
})

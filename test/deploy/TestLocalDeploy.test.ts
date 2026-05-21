import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import hre from 'hardhat'
import { getAddress, labelhash, namehash, zeroAddress, zeroHash } from 'viem'

import { getAccounts } from '../fixtures/utils.js'

// Autonomous post-deploy verification of the local root-ownership handoff
// (VALIDATION row 2-03-03). This is the local equivalent of the D-05 smoke
// deploy: Plan 04 runs the same harness against RISE testnet.
//
// This test does NOT re-deploy contracts inline — it reads the rocketh
// deployment store produced by `bun run deploy:local` (the `deployments/localhost/`
// artifacts) and asserts the deploy harness wired everything correctly. It is
// run AFTER `bun run deploy:local` in the Task 3 `<verify>` chain.
const DEPLOYMENTS_DIR = join(process.cwd(), 'deployments', 'localhost')

type Deployment = { address: `0x${string}`; abi: readonly unknown[] }

function readDeployment(name: string): Deployment {
  const raw = readFileSync(join(DEPLOYMENTS_DIR, `${name}.json`), 'utf-8')
  return JSON.parse(raw) as Deployment
}

// Connect to the `localhost` network — the network `deploy:local` targeted.
const connection = await hre.network.connect({ network: 'localhost' })
const accounts = await getAccounts(connection)

// rocketh's namedAccounts: deployer = index 0, owner = index 1 (the D-14
// two-account model — see rocketh.ts). These are the addresses the deploy
// harness resolved on the `localhost` network.
const deployer = getAddress(accounts[0].address)
const owner = getAddress(accounts[1].address)

describe('LocalDeploy', () => {
  it('deploys all three contracts with non-zero addresses', async () => {
    const registry = readDeployment('RNSRegistry')
    const root = readDeployment('RNSRoot')
    const securityController = readDeployment('RNSRootSecurityController')

    expect(registry.address).not.toEqual(zeroAddress)
    expect(root.address).not.toEqual(zeroAddress)
    expect(securityController.address).not.toEqual(zeroAddress)
  })

  it('hands registry root node 0x0 to the RNSRoot contract (CORE-03)', async () => {
    const registryDep = readDeployment('RNSRegistry')
    const rootDep = readDeployment('RNSRoot')

    const registry = await connection.viem.getContractAt(
      'RNSRegistry',
      registryDep.address,
    )

    await expect(registry.read.owner([zeroHash])).resolves.toEqualAddress(
      rootDep.address,
    )
  })

  it('wires both controllers on RNSRoot', async () => {
    const rootDep = readDeployment('RNSRoot')
    const securityControllerDep = readDeployment('RNSRootSecurityController')

    const root = await connection.viem.getContractAt('RNSRoot', rootDep.address)

    await expect(root.read.controllers([deployer])).resolves.toEqual(true)
    await expect(
      root.read.controllers([securityControllerDep.address]),
    ).resolves.toEqual(true)
  })

  it('hands RNSRoot and RNSRootSecurityController ownership to `owner` (D-14/D-16)', async () => {
    const rootDep = readDeployment('RNSRoot')
    const securityControllerDep = readDeployment('RNSRootSecurityController')

    const root = await connection.viem.getContractAt('RNSRoot', rootDep.address)
    const securityController = await connection.viem.getContractAt(
      'RNSRootSecurityController',
      securityControllerDep.address,
    )

    await expect(root.read.owner()).resolves.toEqualAddress(owner)
    await expect(securityController.read.owner()).resolves.toEqualAddress(owner)
  })

  it('exercised a genuine two-account handoff: owner !== deployer', () => {
    // If `owner` resolved to the same account as `deployer`, the ownership
    // assertions above would be vacuously satisfied — this guard makes the
    // D-14 two-account gate real (threat T-02-18).
    expect(owner).not.toEqual(deployer)
  })

  it('lets a registered controller create an arbitrary TLD subnode', async () => {
    // Functional check (the D-05 "a subnode can be created" goal): the deployer
    // is a registered controller, so it can call RNSRoot.setSubnodeOwner to
    // create a TLD, and the new owner is readable from the registry.
    const registryDep = readDeployment('RNSRegistry')
    const rootDep = readDeployment('RNSRoot')

    const registry = await connection.viem.getContractAt(
      'RNSRegistry',
      registryDep.address,
    )
    const root = await connection.viem.getContractAt('RNSRoot', rootDep.address)

    const label = 'test'
    const newOwner = accounts[2].address

    await root.write.setSubnodeOwner([labelhash(label), newOwner], {
      account: accounts[0], // the deployer — a registered controller
    })

    await expect(
      registry.read.owner([namehash(label)]),
    ).resolves.toEqualAddress(newOwner)
  })
})

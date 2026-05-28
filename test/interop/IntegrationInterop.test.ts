import hre from 'hardhat'
import { encodeFunctionData, namehash, type Address, type Hex } from 'viem'

import { loadAndExecuteDeployments } from '../../rocketh.js'
import { getAccounts } from '../fixtures/utils.js'
import { registerRiseName } from '../fixtures/registerRiseName.js'

// Phase 8 (v1.1) — RiseInteropResolver cross-contract integration suite (Plan
// 08-02, INTEROP-01). Runs the FULL Phase 1->8 deploy chain inline via the
// rocketh-in-test fixture (loadAndExecuteDeployments against the edr-simulated
// in-process provider), mirroring IntegrationSubdomain.test.ts exactly.
//
// This proves the end-to-end resolution chain against live-deployed contracts:
//   node -> RNSRegistry.resolver(node) -> IAddrResolver.addr(node) [COIN_TYPE_ETH]
//        -> ERC-7930 encode (chainId 11155931 supplied by the deploy script, D-10).
// A real `.rise` name is registered through the commit->reveal->register flow with
// its resolver + primary addr set during registration (the REG-04 idiom:
// resolver=PublicResolver + data=[setAddr]). Then interopAddress([node]) must equal
// the deploy-time chainId-11155931 vector (0x0001000003aa39db14 || addr).
//
// `-t` filter token embedded in describe titles: interop.

const connection = await hre.network.connect()
const accounts = await getAccounts(connection)

// rocketh.ts namedAccounts: deployer = Hardhat index 0; owner = Hardhat index 1.
// Phase 6's controller transfers ownership to the named owner during deploy, so
// allowlist/endLaunch writes are signed by `owner`.
const owner = accounts[1]
const alice = accounts[2] // registrant / name owner
const bob = accounts[3] // the primary EVM address `A` we encode

// Deploy-time chainId-11155931 (0xaa39db) prefix: Version|ChainType|
// ChainRefLen(03)|ChainRef(aa39db)|AddrLen(14). The 20-byte address is appended.
const TESTNET_PREFIX = '0x0001000003aa39db14'

async function fixture() {
  // Run the full Phase 1-8 deploy chain inside the test process (Phase 2 registry
  // + root -> Phase 3 registrar + SC -> Phase 4 resolvers -> Phase 5 price oracle
  // -> Phase 6 reverse-registrars + controller + activation gates -> Phase 7
  // subdomain registrar -> Phase 8 interop resolver).
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
  const controller = await connection.viem.getContractAt(
    'RiseRegistrarController',
    env.deployments.RiseRegistrarController.address as `0x${string}`,
  )
  const publicResolver = await connection.viem.getContractAt(
    'PublicResolver',
    env.deployments.PublicResolver.address as `0x${string}`,
  )
  const riseInteropResolver = await connection.viem.getContractAt(
    'RiseInteropResolver',
    env.deployments.RiseInteropResolver.address as `0x${string}`,
  )

  return { rns, controller, publicResolver, riseInteropResolver }
}
const loadFixture = async () => connection.networkHelpers.loadFixture(fixture)

/**
 * Register a `.rise` name end-to-end with a resolver + (optionally) a primary
 * addr set during registration. Mirrors IntegrationRegistration REG-04: the
 * controller's mid-registration multicallWithNodeCheck runs the setAddr inner
 * call, so the new name has a live forward record. Allowlists the registrant
 * (launchActive defaults true at deploy) and wires PublicResolver's trusted
 * controller so the setAddr inner-call bypasses authorised(node).
 */
async function registerName(
  controller: Awaited<ReturnType<typeof fixture>>['controller'],
  publicResolver: Awaited<ReturnType<typeof fixture>>['publicResolver'],
  label: string,
  registrant: { address: `0x${string}` },
  primaryAddr?: Address,
) {
  await publicResolver.write.setTrustedController([controller.address], {
    account: owner,
  })
  await controller.write.setAllowlisted([registrant.address, true], {
    account: owner,
  })

  const node = namehash(`${label}.rise`) as Hex
  const data: Hex[] = []
  if (primaryAddr) {
    data.push(
      encodeFunctionData({
        abi: publicResolver.abi,
        functionName: 'setAddr',
        args: [node, primaryAddr],
      }),
    )
  }

  await registerRiseName(
    controller,
    connection.networkHelpers,
    {
      label,
      ownerAddress: registrant.address,
      resolver: publicResolver.address,
      data,
    },
    { caller: registrant },
  )
  return node
}

describe('IntegrationInterop (Phase 8 — full-chain cross-contract gate)', () => {
  describe('interop', () => {
    it('INTEROP-01: resolves a real .rise name to its ERC-7930 interop address end-to-end', async () => {
      const { controller, publicResolver, riseInteropResolver } =
        await loadFixture()

      // Register `agent.rise` to alice, with bob.address as the primary EVM addr.
      const A = bob.address as Address
      const node = await registerName(
        controller,
        publicResolver,
        'agent',
        alice,
        A,
      )

      // Sanity: the forward record is live through the full chain.
      await expect(
        publicResolver.read.addr([node]) as Promise<Address>,
      ).resolves.toEqualAddress(A)

      // The interop view resolves node -> resolver -> addr -> ERC-7930 encode with
      // the deploy-time chainId 11155931 (0xaa39db).
      const encoded = await riseInteropResolver.read.interopAddress([node])
      const expected = (TESTNET_PREFIX + A.slice(2).toLowerCase()) as Hex
      expect(encoded.toLowerCase()).toBe(expected.toLowerCase())
      // 29 bytes total => 0x + 58 hex chars = 60-char string.
      expect(encoded.length).toBe(60)
    }, 120_000) // full Phase 1-8 in-process deploy chain exceeds the 5s default

    it('INTEROP-01: reverts NoPrimaryAddress for a name with no addr record', async () => {
      const { controller, publicResolver, riseInteropResolver } =
        await loadFixture()

      // Register `noaddr.rise` WITH a resolver but WITHOUT a primary addr record.
      const node = await registerName(
        controller,
        publicResolver,
        'noaddr',
        alice,
      )

      await expect(
        riseInteropResolver.read.interopAddress([node]),
      ).toBeRevertedWithCustomError('NoPrimaryAddress')
    }, 120_000) // full Phase 1-8 in-process deploy chain exceeds the 5s default
  })
})

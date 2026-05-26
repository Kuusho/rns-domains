import hre from 'hardhat'
import { toFunctionSelector } from 'viem'

import { loadAndExecuteDeployments } from '../../rocketh.js'
import { getAccounts } from '../fixtures/utils.js'

// Phase 5 integration suite — closes PRICE-05 end-to-end via the rocketh-in-test
// fixture pattern established by Phase 3's TestRiseTLDIntegration.test.ts and
// re-used by Phase 4's IntegrationResolution.test.ts (D-10 in 05-CONTEXT.md +
// D-14 from Phase 3 RESEARCH Pattern 5). Runs the full deploy chain against
// the in-process edr-simulated provider so the deployed RisePriceOracle is
// exercised through the IPriceOracle interface exactly as Phase 6's
// RiseRegistrarController will consume it.
//
// Pattern 5 cast: connection.provider is cast to `never` to bypass the
// EIP1193Provider type strictness, mirroring hardhat-deploy's own wrapper.
// saveDeployments=false because the edr-simulated state is ephemeral.
//
// Scope per Plan 05-04:
//   1. PRICE-01 + PRICE-05: interface-typed read returns the seeded 5+-char price.
//   2. PRICE-02: per-length schedule produces the seeded prices for every tier.
//   3. PRICE-04: deploy script transferred ownership to the named `owner` account.
//   4. PRICE-05: oracle advertises IPriceOracle via ERC-165 (interfaceId selector).
//   5. PRICE-03: oracle reads do NOT depend on any external feed (zero-state read).

const connection = await hre.network.connect()
const accounts = await getAccounts(connection)

// Reference schedule mirrors deploy/registrar-controller/00_deploy_rise_price_oracle.ts.
// If the deploy script's INITIAL_RENT_PRICES change, this set MUST be updated in lockstep
// — this is the locking property of the integration test (codifies deployed values).
const EXPECTED_SEEDS = {
  oneChar: 500_000_000n,
  twoChar: 500_000_000n,
  threeChar: 100_000_000n,
  fourChar: 75_000_000n,
  fiveCharPlus: 50_000_000n,
}

// IPriceOracle interfaceId — computed at runtime from the function signature via
// viem.toFunctionSelector. For a single-function interface, Solidity's
// `type(IPriceOracle).interfaceId` IS that one function's selector (the XOR of
// one element is itself). Using viem.toFunctionSelector ensures the constant is
// correct without hand-computing keccak256 — hallucination-proof.
//
// Solidity reference (contracts/registrar-controller/IPriceOracle.sol):
//   function price(string calldata name, uint256 expires, uint256 duration)
//       external view returns (Price calldata);
//
// Function selectors are computed from the canonical signature
// `price(string,uint256,uint256)` — return types do NOT participate. The
// full-ABI form below is what viem accepts; the resulting selector is
// `bytes4(keccak256("price(string,uint256,uint256)"))` = 0x50e9a715.
const IPRICE_ORACLE_SELECTOR = toFunctionSelector('function price(string,uint256,uint256) view returns (uint256,uint256)')

async function fixture() {
  // Run the full deploy chain inside the test process. RisePriceOracle has
  // dependencies: [] so it deploys independently; rocketh will execute any
  // other deploy script it discovers in deploy/ as well (Phases 1+2+3+4+5) —
  // that's fine, this test only asserts on Phase 5 outputs (per 05-CONTEXT.md
  // D-10 "skipping Phase 4" means LOGICAL independence, not selective exclusion).
  const env = await loadAndExecuteDeployments({
    provider: connection.provider as never,
    network: connection.networkName,
    saveDeployments: false,
    askBeforeProceeding: false,
    logLevel: 0,
  })

  const oracleAddress = env.deployments.RisePriceOracle.address as `0x${string}`
  const oracle = await connection.viem.getContractAt('RisePriceOracle', oracleAddress)
  // PRICE-05 evidence: read through the IPriceOracle interface ABI to confirm
  // the surface Phase 6's controller will use stays in sync with the deployed
  // bytecode. If a future plan accidentally narrows the price() return type or
  // changes its parameter list, this read decodes incorrectly and fails.
  const oracleViaInterface = await connection.viem.getContractAt('IPriceOracle', oracleAddress)

  return { oracle, oracleViaInterface }
}
const loadFixture = async () => connection.networkHelpers.loadFixture(fixture)

// rocketh.ts namedAccounts: `owner` = Hardhat index 1 — the address the deploy
// script's transferOwnership(owner) call should hand control to. Mirrors the
// Phase 4 IntegrationResolution pattern.
const owner = accounts[1]

describe('IntegrationPricing', () => {
  it('PRICE-01 + PRICE-05: deployed oracle returns price through IPriceOracle interface', async () => {
    const { oracleViaInterface } = await loadFixture()
    // Call through the IPriceOracle ABI (not the concrete RisePriceOracle ABI) —
    // this is the surface Phase 6's controller will use. If the deploy script
    // left an ABI mismatch or the interface drifted from the implementation,
    // this read fails.
    const duration = 100n
    const result = await oracleViaInterface.read.price(['alice', 0n, duration])
    expect(result.base).toBe(EXPECTED_SEEDS.fiveCharPlus * duration)
    expect(result.premium).toBe(0n)
  })

  it('PRICE-02: per-length schedule produces distinct prices end-to-end', async () => {
    const { oracle } = await loadFixture()
    const duration = 100n
    const [oneCharPrice, twoCharPrice, threeCharPrice, fourCharPrice, fiveCharPrice] =
      await Promise.all([
        oracle.read.price(['a', 0n, duration]).then((p) => p.base),
        oracle.read.price(['ab', 0n, duration]).then((p) => p.base),
        oracle.read.price(['abc', 0n, duration]).then((p) => p.base),
        oracle.read.price(['abcd', 0n, duration]).then((p) => p.base),
        oracle.read.price(['abcde', 0n, duration]).then((p) => p.base),
      ])
    expect(oneCharPrice).toBe(EXPECTED_SEEDS.oneChar * duration)
    expect(twoCharPrice).toBe(EXPECTED_SEEDS.twoChar * duration)
    expect(threeCharPrice).toBe(EXPECTED_SEEDS.threeChar * duration)
    expect(fourCharPrice).toBe(EXPECTED_SEEDS.fourChar * duration)
    expect(fiveCharPrice).toBe(EXPECTED_SEEDS.fiveCharPlus * duration)
    // PRICE-02 enforcement: lengths 3, 4, 5+ all distinct (1 and 2 deliberately
    // equal per D-02 — 10x base brand-protection without length-revert).
    expect(new Set([threeCharPrice, fourCharPrice, fiveCharPrice]).size).toBe(3)
  })

  it('PRICE-04: deploy script transferred ownership to the named `owner` account', async () => {
    const { oracle } = await loadFixture()
    await expect(oracle.read.owner()).resolves.toEqualAddress(owner.address)
  })

  it('PRICE-05: oracle advertises IPriceOracle via ERC-165 (controller-consumability evidence)', async () => {
    const { oracle } = await loadFixture()
    // IPRICE_ORACLE_SELECTOR is computed at module load via viem.toFunctionSelector
    // (see top-level constant). For a single-function interface, that selector IS
    // `type(IPriceOracle).interfaceId` — Solidity's interfaceId for an interface
    // with one function equals that function's selector.
    await expect(
      oracle.read.supportsInterface([IPRICE_ORACLE_SELECTOR]),
    ).resolves.toBe(true)
    await expect(oracle.read.supportsInterface(['0x01ffc9a7'])).resolves.toBe(
      true,
    ) // IERC165
    await expect(oracle.read.supportsInterface(['0xffffffff'])).resolves.toBe(
      false,
    )
  })

  it('PRICE-03: oracle reads do NOT depend on any external oracle/feed (zero-state read)', async () => {
    // Negative-evidence test: oracle.price() succeeds without any setup beyond
    // construction. If the contract secretly depended on a Chainlink feed or
    // any other external read, this call would revert.
    const { oracleViaInterface } = await loadFixture()
    // Read with duration = 1 second — minimal arithmetic, no external state.
    const result = await oracleViaInterface.read.price(['xyzwq', 0n, 1n])
    expect(result.base).toBe(EXPECTED_SEEDS.fiveCharPlus)
    expect(result.premium).toBe(0n)
  })
})

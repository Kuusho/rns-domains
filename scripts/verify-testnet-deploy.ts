// ----------------------------------------------------------------------------
// scripts/verify-testnet-deploy.ts
// ----------------------------------------------------------------------------
// Post-deploy verification for the RiseChain testnet smoke deploy (Plan 02-04,
// D-05). Mirrors the local-deploy verification in
// test/deploy/TestLocalDeploy.test.ts, but pointed at the live RISE testnet
// (chainId 11155931) and reading the `deployments/riseTestnet/` artifacts.
//
// Two modes — VALIDATION.md explicitly excludes the testnet smoke deploy from
// the <30s per-task sampling loop, so the state-changing exercise is gated
// behind an explicit `--live` flag:
//
//   1. Read-only (default, also `--read-only`)
//      Asserts:
//        a) RNSRegistry, RNSRoot, RNSRootSecurityController each have a
//           non-zero address in deployments/riseTestnet/;
//        b) RNSRegistry.owner(zeroHash) on testnet returns the RNSRoot address
//           (CORE-03 at the testnet level — the root-ownership handoff).
//      Pure reads. No signer needed. Safe to run repeatedly.
//
//   2. Live (`--live` or `--exercise`)
//      Additionally performs an on-chain setSubnodeOwner round-trip:
//        - via the deployer (a registered controller from the linear setup),
//        - calls RNSRoot.setSubnodeOwner(labelhash('smoke'), deployerAddr),
//        - asserts RNSRegistry.owner(namehash('smoke')) == deployerAddr.
//      This is a real state-changing testnet transaction — kept out of the
//      per-task sampling loop per VALIDATION.md, run during the Task 3
//      human-verify checkpoint.
//
// Configuration (env vars):
//   RISE_TESTNET_RPC — RPC URL. Defaults to https://testnet.riselabs.xyz
//                      (the canonical public endpoint per research A3). Set
//                      this if you want to point at Alchemy / another provider.
//   DEPLOYER_KEY     — 0x-prefixed private key. REQUIRED for --live mode only.
//                      Read-only mode never touches it.
// ----------------------------------------------------------------------------

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  labelhash,
  namehash,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const CHAIN_ID = 11155931
const DEFAULT_RPC = 'https://testnet.riselabs.xyz'
const DEPLOYMENTS_DIR = join(process.cwd(), 'deployments', 'riseTestnet')

// Define the RISE testnet chain inline — avoids a viem/chains dependency on
// a chain that may not be in the bundled list yet.
const riseTestnet = {
  id: CHAIN_ID,
  name: 'RISE Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [DEFAULT_RPC] },
    public: { http: [DEFAULT_RPC] },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://explorer.testnet.riselabs.xyz' },
  },
} as const

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

type Deployment = {
  address: Address
  abi: readonly unknown[]
  transaction?: { hash?: Hex }
  receipt?: { transactionHash?: Hex; blockNumber?: bigint | number | string }
}

function readDeployment(name: string): Deployment {
  const path = join(DEPLOYMENTS_DIR, `${name}.json`)
  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch (e) {
    throw new Error(
      `Missing deployment artifact at ${path}. Run \`bunx hardhat deploy --network riseTestnet --skip-prompts\` first.`,
    )
  }
  return JSON.parse(raw) as Deployment
}

function pass(label: string, detail = '') {
  console.log(`  PASS  ${label}${detail ? ' — ' + detail : ''}`)
}

function fail(label: string, detail: string): never {
  console.error(`  FAIL  ${label} — ${detail}`)
  process.exitCode = 1
  throw new Error(`${label}: ${detail}`)
}

function getRpcUrl(): string {
  return process.env.RISE_TESTNET_RPC ?? DEFAULT_RPC
}

// ----------------------------------------------------------------------------
// Verifications
// ----------------------------------------------------------------------------

async function runReadOnlyChecks(opts: {
  registry: Deployment
  root: Deployment
  securityController: Deployment
}) {
  const { registry, root, securityController } = opts

  // (a) Three non-zero addresses
  console.log('\n[1/2] Artifact integrity — three non-zero addresses')
  for (const [name, dep] of [
    ['RNSRegistry', registry] as const,
    ['RNSRoot', root] as const,
    ['RNSRootSecurityController', securityController] as const,
  ]) {
    if (!dep.address || dep.address === zeroAddress) {
      fail(`${name} address`, `address is empty or zero (${dep.address})`)
    }
    pass(`${name} address`, getAddress(dep.address))
  }

  // (b) RNSRegistry.owner(zeroHash) on testnet returns RNSRoot's address
  console.log('\n[2/2] On-chain root-ownership — RNSRegistry.owner(0x0) == RNSRoot')
  const rpc = getRpcUrl()
  const publicClient = createPublicClient({
    chain: riseTestnet,
    transport: http(rpc),
  })

  // Sanity-check the RPC actually points at chainId 11155931.
  const observedChainId = await publicClient.getChainId()
  if (observedChainId !== CHAIN_ID) {
    fail(
      'RPC chainId sanity check',
      `expected ${CHAIN_ID}, got ${observedChainId} from ${rpc}`,
    )
  }
  pass('RPC chainId', `${observedChainId} via ${rpc}`)

  const ownerOfRoot = (await publicClient.readContract({
    address: registry.address,
    abi: registry.abi as never,
    functionName: 'owner',
    args: [zeroHash],
  })) as Address
  if (getAddress(ownerOfRoot) !== getAddress(root.address)) {
    fail(
      'RNSRegistry.owner(0x0)',
      `expected ${getAddress(root.address)} (RNSRoot), got ${getAddress(ownerOfRoot)}`,
    )
  }
  pass('RNSRegistry.owner(0x0)', `== RNSRoot ${getAddress(root.address)}`)
}

async function runLiveExercise(opts: {
  registry: Deployment
  root: Deployment
}) {
  const { registry, root } = opts

  console.log(
    '\n[3/3] Live exercise — RNSRoot.setSubnodeOwner(labelhash("smoke"), deployer)',
  )

  const deployerKey = process.env.DEPLOYER_KEY
  if (!deployerKey) {
    fail(
      '--live mode',
      'DEPLOYER_KEY env var not set. Export it (or `bunx hardhat run` via keystore) and re-run.',
    )
  }
  const normalisedKey = (
    deployerKey.startsWith('0x') ? deployerKey : `0x${deployerKey}`
  ) as Hex

  const rpc = getRpcUrl()
  const account = privateKeyToAccount(normalisedKey)
  const publicClient = createPublicClient({
    chain: riseTestnet,
    transport: http(rpc),
  })
  const walletClient = createWalletClient({
    account,
    chain: riseTestnet,
    transport: http(rpc),
  })

  console.log(`  Using deployer EOA: ${account.address}`)

  // Pre-flight: the deployer must be a registered controller on RNSRoot
  // (otherwise setSubnodeOwner reverts with "Controllable: ..."). The local
  // setup script wires this; we read it back here as a sanity check.
  const isController = (await publicClient.readContract({
    address: root.address,
    abi: root.abi as never,
    functionName: 'controllers',
    args: [account.address],
  })) as boolean
  if (!isController) {
    fail(
      'Deployer is a controller on RNSRoot',
      `RNSRoot.controllers(${account.address}) returned false — the setup script may not have wired the deployer (re-run the deploy).`,
    )
  }
  pass(
    'Deployer is a controller on RNSRoot',
    `controllers(${account.address}) == true`,
  )

  // The live round-trip
  const label = 'smoke'
  const labelHash = labelhash(label)
  const nodeHash = namehash(label) // namehash of a TLD = keccak256(0x0, labelhash)

  console.log(
    `  Sending setSubnodeOwner(labelhash('${label}'), ${account.address}) ...`,
  )
  const txHash = await walletClient.writeContract({
    address: root.address,
    abi: root.abi as never,
    functionName: 'setSubnodeOwner',
    args: [labelHash, account.address],
  })
  console.log(`  tx: ${txHash}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
  if (receipt.status !== 'success') {
    fail(
      'setSubnodeOwner tx',
      `tx ${txHash} reverted (status=${receipt.status}); see explorer at https://explorer.testnet.riselabs.xyz/tx/${txHash}`,
    )
  }
  pass('setSubnodeOwner tx', `mined in block ${receipt.blockNumber} (${txHash})`)

  // Read it back from the registry
  const newOwner = (await publicClient.readContract({
    address: registry.address,
    abi: registry.abi as never,
    functionName: 'owner',
    args: [nodeHash],
  })) as Address
  if (getAddress(newOwner) !== getAddress(account.address)) {
    fail(
      `RNSRegistry.owner(namehash('${label}'))`,
      `expected ${getAddress(account.address)}, got ${getAddress(newOwner)}`,
    )
  }
  pass(
    `RNSRegistry.owner(namehash('${label}'))`,
    `== deployer ${getAddress(account.address)}`,
  )
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2)
  const live = argv.includes('--live') || argv.includes('--exercise')
  // --read-only is the default; accept it explicitly for plan-clarity:
  //   node scripts/verify-testnet-deploy.ts --read-only

  console.log('---')
  console.log('RNS testnet smoke-deploy verification')
  console.log(`  chainId      : ${CHAIN_ID}`)
  console.log(`  rpc          : ${getRpcUrl()}`)
  console.log(`  deployments  : ${DEPLOYMENTS_DIR}`)
  console.log(`  mode         : ${live ? 'LIVE (state-changing)' : 'read-only'}`)
  console.log('---')

  const registry = readDeployment('RNSRegistry')
  const root = readDeployment('RNSRoot')
  const securityController = readDeployment('RNSRootSecurityController')

  await runReadOnlyChecks({ registry, root, securityController })

  if (live) {
    await runLiveExercise({ registry, root })
  }

  if (process.exitCode && process.exitCode !== 0) {
    console.error('\nVERIFICATION FAILED')
    return
  }
  console.log(
    `\nALL CHECKS PASSED (${live ? 'read-only + live' : 'read-only'})`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

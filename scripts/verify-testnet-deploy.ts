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
// Configuration — env vs keystore:
//   Each of RISE_TESTNET_RPC and DEPLOYER_KEY is resolved with an env-FIRST
//   policy:
//     1. process.env[KEY] if present and non-empty AND it passes a value-
//        shape gate (URL for RPC; 0x + 64 hex chars for DEPLOYER_KEY). Used
//        directly — the keystore is skipped entirely.
//     2. Otherwise `bunx hardhat keystore get <KEY>` is tried; the captured
//        stdout is only used if exit code == 0 AND it passes the same value-
//        shape gate (this rejects the "No production keystore found..."
//        error message hardhat prints to stdout on a missing store).
//     3. Otherwise a clear error names the variable, both attempted sources,
//        and the two recovery paths (`hardhat keystore set KEY` in a real
//        TTY, or inline-export the env var before invoking this script).
//
//   RISE_TESTNET_RPC — RPC URL. Defaults to https://testnet.riselabs.xyz only
//                      for the read-only / default-banner display; the env-
//                      first resolver is invoked for the actual connect.
//   DEPLOYER_KEY     — 0x-prefixed private key. REQUIRED for --live mode only.
//                      Read-only mode never touches it.
// ----------------------------------------------------------------------------

import { spawnSync } from 'node:child_process'
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

// ----------------------------------------------------------------------------
// Env-first credential resolution
// ----------------------------------------------------------------------------
// Resolves a config value (RISE_TESTNET_RPC, DEPLOYER_KEY) from the env, with
// a keystore fallback. Both sources are gated by a shape validator — this
// rejects e.g. hardhat's "No production keystore found..." error message,
// which it prints to stdout (not stderr) and would otherwise be silently
// substituted as the resolved value.

type ValueShape = 'rpc' | 'privateKey'

function isValidShape(kind: ValueShape, value: string): boolean {
  if (!value) return false
  const trimmed = value.trim()
  if (!trimmed) return false
  if (kind === 'rpc') {
    if (!/^https?:\/\//i.test(trimmed)) return false
    try {
      new URL(trimmed)
      return true
    } catch {
      return false
    }
  }
  // kind === 'privateKey'
  return /^0x[0-9a-fA-F]{64}$/.test(trimmed)
}

function tryEnv(envKey: string, kind: ValueShape): string | null {
  const raw = process.env[envKey]
  if (!raw) return null
  return isValidShape(kind, raw) ? raw.trim() : null
}

function tryKeystore(envKey: string, kind: ValueShape): string | null {
  // `bunx hardhat keystore get <KEY>` — capture BOTH stdout and exit code.
  // If exit code != 0, the keystore is unavailable (missing store, missing
  // key, decryption failure, etc.). If exit code == 0 but the stdout payload
  // doesn't shape-validate (e.g. "No production keystore found..."), treat
  // it as unavailable too.
  let result
  try {
    result = spawnSync('bunx', ['hardhat', 'keystore', 'get', envKey], {
      encoding: 'utf-8',
      // Don't inherit stdio — we want to inspect stdout, and we don't want
      // hardhat's prompts to spray into our own output.
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    return null
  }
  if (result.status !== 0) return null
  const stdout = (result.stdout ?? '').trim()
  // The reference failure mode we explicitly guard against:
  if (/No production keystore found/i.test(stdout)) return null
  return isValidShape(kind, stdout) ? stdout : null
}

function resolveConfigValue(envKey: string, kind: ValueShape): string {
  const fromEnv = tryEnv(envKey, kind)
  if (fromEnv) return fromEnv
  const fromKeystore = tryKeystore(envKey, kind)
  if (fromKeystore) return fromKeystore

  const shapeHint =
    kind === 'rpc'
      ? 'an http(s) URL'
      : 'a 0x-prefixed 32-byte hex string (0x + 64 hex chars)'
  console.error(
    `\n${envKey} unavailable: not in process.env, and keystore lookup failed.`,
  )
  console.error(`  expected shape: ${shapeHint}`)
  console.error(
    `  (no usable encrypted store at ~/.config/hardhat-nodejs/keystore.json — run`,
  )
  console.error(
    `   \`bunx hardhat keystore set ${envKey}\` in a real TTY, or export`,
  )
  console.error(`   ${envKey} inline before invoking this script)`)
  process.exit(1)
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return '<invalid-url>'
  }
}

function getRpcUrl(): string {
  return resolveConfigValue('RISE_TESTNET_RPC', 'rpc')
}

// ----------------------------------------------------------------------------
// Verifications
// ----------------------------------------------------------------------------

async function runReadOnlyChecks(opts: {
  registry: Deployment
  root: Deployment
  securityController: Deployment
  rpc: string
}) {
  const { registry, root, securityController, rpc } = opts

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
  const publicClient = createPublicClient({
    chain: riseTestnet,
    transport: http(rpc),
  })

  // Sanity-check the RPC actually points at chainId 11155931. We log only the
  // host of the RPC URL (not the full URL) — the URL may carry a provider
  // API key (Alchemy etc.) we don't want pasted back into chat or commits.
  const observedChainId = await publicClient.getChainId()
  if (observedChainId !== CHAIN_ID) {
    fail(
      'RPC chainId sanity check',
      `expected ${CHAIN_ID}, got ${observedChainId} from host ${hostOf(rpc)}`,
    )
  }
  pass('RPC chainId', `${observedChainId} via ${hostOf(rpc)}`)

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
  rpc: string
}) {
  const { registry, root, rpc } = opts

  console.log(
    '\n[3/3] Live exercise — RNSRoot.setSubnodeOwner(labelhash("smoke"), deployer)',
  )

  // Env-first resolution — same gates as the RPC URL. The validator already
  // enforces the 0x + 64 hex shape, so we don't need a separate normaliser.
  const deployerKey = resolveConfigValue('DEPLOYER_KEY', 'privateKey') as Hex

  const account = privateKeyToAccount(deployerKey)
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

  // Resolve the RPC up front (env-first; keystore fallback). We log only its
  // host — never the full URL — because it may embed a provider API key.
  const resolvedRpc = getRpcUrl()
  console.log('---')
  console.log('RNS testnet smoke-deploy verification')
  console.log(`  chainId      : ${CHAIN_ID}`)
  console.log(`  rpc host     : ${hostOf(resolvedRpc)}`)
  console.log(`  deployments  : ${DEPLOYMENTS_DIR}`)
  console.log(`  mode         : ${live ? 'LIVE (state-changing)' : 'read-only'}`)
  console.log('---')

  const registry = readDeployment('RNSRegistry')
  const root = readDeployment('RNSRoot')
  const securityController = readDeployment('RNSRootSecurityController')

  await runReadOnlyChecks({ registry, root, securityController, rpc: resolvedRpc })

  if (live) {
    await runLiveExercise({ registry, root, rpc: resolvedRpc })
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

// ----------------------------------------------------------------------------
// scripts/verify-registration-testnet.ts
// ----------------------------------------------------------------------------
// Phase 6 D-12 closure-gate verifier. Sibling to scripts/verify-testnet-deploy.ts
// (Phase 2 CORE-01..05 verifier). Scopes to REG-01..REG-13 via 5 operator-
// confirmed points on the live RiseChain testnet (chainId 11155931).
//
// Two modes — on a fully-green run, expect 7 PASS lines (RPC chainId + the 5
// numbered verification points + 1 sub-check):
//   PASS  RPC chainId                                            (sanity)
//   PASS  REG-13 (addr.reverse subnode owner)                    (Point 1)
//   PASS  REG-13 (RiseRegistrar controller)                      (Point 2a)
//   PASS  REG-13 (ReverseRegistrar controller)                   (Point 2b)
//   PASS  REG-13 (DefaultReverseRegistrar controller)            (Point 2c)
//   PASS  REG-01 + REG-02 (commit→reveal→register '…')           (Point 3)
//   PASS  REG-03 (renew extends expiry)                          (Point 4)
//   PASS  REG-06 + REG-07 (setName → nameForAddr lookup)         (Point 5)
//
//   1. Read-only (default, also `--read-only`)
//      Asserts:
//        Point 1: RNSRegistry.owner(namehash('addr.reverse')) ==
//                 ReverseRegistrar.address                              (REG-13)
//        Point 2: RiseRegistrar.controllers(controller)         == true (REG-13)
//                 ReverseRegistrar.controllers(controller)      == true (REG-13)
//                 DefaultReverseRegistrar.controllers(controller)== true (REG-13)
//      Pure reads. No signer needed. Safe to run repeatedly.
//
//   2. Live (`--live` or `--exercise`)
//      Additionally performs the full commit→reveal→register / renew /
//      setName round-trip:
//        Point 3: commit→reveal→register flow             (REG-01 / REG-02)
//        Point 4: renew(label, duration) extends expiry             (REG-03)
//        Point 5: DefaultReverseRegistrar.setName + nameForAddr
//                 round-trip                                (REG-06 / REG-07)
//      Requires DEPLOYER_KEY (env-first then keystore fallback). Sends real
//      transactions on the live testnet. Sleeps 60s between commit and
//      register (minCommitmentAge).
//
// Configuration — env vs keystore (mirrors verify-testnet-deploy.ts policy):
//   Each of RISE_TESTNET_RPC and DEPLOYER_KEY is resolved with an env-FIRST
//   policy:
//     1. process.env[KEY] if present and non-empty AND it passes a value-
//        shape gate (URL for RPC; 0x + 64 hex chars for DEPLOYER_KEY).
//     2. Otherwise `npx hardhat keystore get <KEY>` is tried; stdout is only
//        used if exit code == 0 AND it passes the same shape gate.
//        Note: this MUST be `npx` (Node) not `bunx` (Bun) — hardhat-keystore@3
//        resolves the encrypted store via Node-specific path APIs, and on
//        some systems Bun's runtime resolves to a different config directory.
//     3. Otherwise a clear error names the variable, both attempted sources,
//        and the two recovery paths.
//
// Hosted-RPC read-after-write lag: post-write reads are wrapped in a bounded
// retry loop (Phase 2 STATE.md lesson). Operator-paced; the 60-second commit
// wait is a real sleep — DO NOT poll.
// ----------------------------------------------------------------------------

import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  keccak256,
  labelhash,
  namehash,
  toBytes,
  toHex,
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

// Inline chain — avoids a viem/chains dep on a chain not yet bundled.
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
}

function readDeployment(name: string): Deployment {
  const path = join(DEPLOYMENTS_DIR, `${name}.json`)
  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch {
    throw new Error(
      `Missing deployment artifact at ${path}. Run \`bun run deploy:rise-testnet\` first.`,
    )
  }
  return JSON.parse(raw) as Deployment
}

// Emits "  PASS  <label> — <detail>" to stdout. Each verification point
// (Point 1 + Point 2's three sub-checks + Point 3 + Point 4 + Point 5)
// calls this on success — totals at least 7 PASS lines on a 5/5-green run.
function pass(label: string, detail = '') {
  console.log(`  PASS  ${label}${detail ? ' — ' + detail : ''}`)
}

function fail(label: string, detail: string): never {
  console.error(`  FAIL  ${label} — ${detail}`)
  process.exitCode = 1
  throw new Error(`${label}: ${detail}`)
}

function assertEq(actual: string, expected: string, label: string) {
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    fail(label, `expected ${expected}, got ${actual}`)
  }
  pass(label, `== ${expected}`)
}

function assertTrue(value: boolean, label: string) {
  if (!value) fail(label, 'expected true, got false')
  pass(label, '== true')
}

// ----------------------------------------------------------------------------
// Env-first credential resolution (verbatim from verify-testnet-deploy.ts)
// ----------------------------------------------------------------------------

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
  return /^0x[0-9a-fA-F]{64}$/.test(trimmed)
}

function tryEnv(envKey: string, kind: ValueShape): string | null {
  const raw = process.env[envKey]
  if (!raw) return null
  return isValidShape(kind, raw) ? raw.trim() : null
}

function tryKeystore(envKey: string, kind: ValueShape): string | null {
  // `npx hardhat keystore get <KEY>` — captures stdout + exit code. If the
  // keystore is unavailable (missing store, decryption failure, or stdout
  // payload shape-validates false), returns null. NOT `bunx` — see file
  // header for rationale.
  let result
  try {
    result = spawnSync('npx', ['hardhat', 'keystore', 'get', envKey], {
      encoding: 'utf-8',
      stdio: ['inherit', 'pipe', 'inherit'],
    })
  } catch {
    return null
  }
  if (result.status !== 0) return null
  const stdout = (result.stdout ?? '').trim()
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
    `   \`npx hardhat keystore set ${envKey}\` in a real TTY, or export`,
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

// ----------------------------------------------------------------------------
// Retry wrapper for hosted-RPC read-after-write lag (Phase 2 lesson)
// ----------------------------------------------------------------------------

async function retryRead<T>(
  fn: () => Promise<T>,
  isOk: (v: T) => boolean,
  label: string,
  maxAttempts = 6,
): Promise<T> {
  let last: T = undefined as T
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = await fn()
    if (isOk(last)) return last
    if (attempt < maxAttempts) {
      const delayMs = 500 * attempt
      console.log(
        `  (read-after-write lag on ${label}, attempt ${attempt}/${maxAttempts} — retrying in ${delayMs}ms)`,
      )
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  return last
}

// ----------------------------------------------------------------------------
// Point 1 + 2 — read-only checks
// ----------------------------------------------------------------------------

async function runReadOnlyChecks(opts: { rpc: string }) {
  const { rpc } = opts

  const rnsRegistry = readDeployment('RNSRegistry')
  const reverseRegistrar = readDeployment('ReverseRegistrar')
  const riseRegistrar = readDeployment('RiseRegistrar')
  const defaultReverseRegistrar = readDeployment('DefaultReverseRegistrar')
  const controller = readDeployment('RiseRegistrarController')

  const publicClient = createPublicClient({
    chain: riseTestnet,
    transport: http(rpc),
  })

  // Sanity-check the RPC actually points at chainId 11155931.
  const observedChainId = await publicClient.getChainId()
  if (observedChainId !== CHAIN_ID) {
    fail(
      'RPC chainId sanity check',
      `expected ${CHAIN_ID}, got ${observedChainId} from host ${hostOf(rpc)}`,
    )
  }
  pass('RPC chainId', `${observedChainId} via ${hostOf(rpc)}`)

  // --------------------------------------------------------------------
  // Point 1: REG-13 — addr.reverse subnode owner == ReverseRegistrar
  // --------------------------------------------------------------------
  console.log(
    "\n[1/5] REG-13 — RNSRegistry.owner(namehash('addr.reverse')) == ReverseRegistrar",
  )
  const ADDR_REVERSE_NODE = namehash('addr.reverse')
  const subnodeOwner = (await publicClient.readContract({
    address: rnsRegistry.address,
    abi: rnsRegistry.abi as never,
    functionName: 'owner',
    args: [ADDR_REVERSE_NODE],
  })) as Address
  assertEq(
    getAddress(subnodeOwner),
    getAddress(reverseRegistrar.address),
    'REG-13 (addr.reverse subnode owner)',
  )

  // --------------------------------------------------------------------
  // Point 2: REG-13 — controller=true on the 3 gating contracts
  // --------------------------------------------------------------------
  console.log(
    '\n[2/5] REG-13 — controllers(RiseRegistrarController) == true on 3 targets',
  )
  for (const [target, label] of [
    [riseRegistrar, 'REG-13 (RiseRegistrar controller)'],
    [reverseRegistrar, 'REG-13 (ReverseRegistrar controller)'],
    [defaultReverseRegistrar, 'REG-13 (DefaultReverseRegistrar controller)'],
  ] as const) {
    const isController = (await publicClient.readContract({
      address: target.address,
      abi: target.abi as never,
      functionName: 'controllers',
      args: [controller.address],
    })) as boolean
    assertTrue(isController, label)
  }
}

// ----------------------------------------------------------------------------
// Point 3 + 4 + 5 — live exercise
// ----------------------------------------------------------------------------

async function runLiveExercise(opts: {
  rpc: string
  deployerKey?: Hex
}) {
  const { rpc } = opts
  const deployerKey =
    opts.deployerKey ?? (resolveConfigValue('DEPLOYER_KEY', 'privateKey') as Hex)

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

  console.log(`\n  Using deployer EOA: ${account.address}`)

  const controller = readDeployment('RiseRegistrarController')
  const riseRegistrar = readDeployment('RiseRegistrar')
  const defaultReverseRegistrar = readDeployment('DefaultReverseRegistrar')

  // Per-run unique label: 'verify-' + 6-char random hex suffix. Ensures the
  // live verifier is rerun-safe (T-06-05-03 mitigation).
  const labelSuffix = randomBytes(3).toString('hex')
  const label = `verify-${labelSuffix}`
  const labelHash = labelhash(label)
  const tokenId = BigInt(labelHash)
  const ONE_YEAR = 365n * 86400n

  // Pre-flight: deployer must be allowlisted (if launchActive is still true).
  // On testnet, deployer == owner per A7, so the deployer is also the
  // controller-Ownable owner — it can self-allowlist if needed.
  const launchActive = (await publicClient.readContract({
    address: controller.address,
    abi: controller.abi as never,
    functionName: 'launchActive',
  })) as boolean
  if (launchActive) {
    const isAllowlisted = (await publicClient.readContract({
      address: controller.address,
      abi: controller.abi as never,
      functionName: 'allowlisted',
      args: [account.address],
    })) as boolean
    if (!isAllowlisted) {
      console.log(`  Deployer not allowlisted — calling setAllowlisted(true)…`)
      const txAllow = await walletClient.writeContract({
        address: controller.address,
        abi: controller.abi as never,
        functionName: 'setAllowlisted',
        args: [account.address, true],
      })
      await publicClient.waitForTransactionReceipt({ hash: txAllow })
      pass('Allowlist self-add', `controllers.setAllowlisted(deployer, true) (${txAllow})`)
    } else {
      pass('Allowlist pre-flight', `deployer already allowlisted`)
    }
  } else {
    pass('Launch state', 'launchActive == false (post-endLaunch — allowlist not required)')
  }

  // --------------------------------------------------------------------
  // Point 3: REG-01 + REG-02 — commit → wait → register
  // --------------------------------------------------------------------
  console.log(`\n[3/5] REG-01 + REG-02 — commit → reveal → register '${label}'`)

  // Read rentPrice up front so we know the value to send with register().
  const price = (await publicClient.readContract({
    address: controller.address,
    abi: controller.abi as never,
    functionName: 'rentPrice',
    args: [label, ONE_YEAR],
  })) as { base: bigint; premium: bigint }
  const totalPrice = price.base + price.premium
  console.log(
    `  rentPrice('${label}', 365d) = base ${price.base} wei + premium ${price.premium} wei (total ${totalPrice} wei)`,
  )

  // Build the Registration struct (must match makeCommitment's encode).
  const secret = toHex(randomBytes(32)) as Hex
  const registration = {
    label,
    owner: account.address,
    duration: ONE_YEAR,
    secret,
    resolver: zeroAddress as Address,
    data: [] as Hex[],
    reverseRecord: 0,
    referrer: zeroHash as Hex,
  }
  const commitmentHash = (await publicClient.readContract({
    address: controller.address,
    abi: controller.abi as never,
    functionName: 'makeCommitment',
    args: [registration],
  })) as Hex

  console.log(`  Committing commitment hash ${commitmentHash}…`)
  const txCommit = await walletClient.writeContract({
    address: controller.address,
    abi: controller.abi as never,
    functionName: 'commit',
    args: [commitmentHash],
  })
  const commitReceipt = await publicClient.waitForTransactionReceipt({ hash: txCommit })
  if (commitReceipt.status !== 'success') {
    fail('commit tx', `tx ${txCommit} reverted (status=${commitReceipt.status})`)
  }
  console.log(`  commit tx mined in block ${commitReceipt.blockNumber} (${txCommit})`)

  // 60-second sleep — minCommitmentAge gate. Operator-visible pacing.
  console.log(`  Waiting 60s (minCommitmentAge) before reveal…`)
  await new Promise((r) => setTimeout(r, 61_000))

  console.log(`  Registering '${label}' (value: ${totalPrice} wei)…`)
  const txRegister = await walletClient.writeContract({
    address: controller.address,
    abi: controller.abi as never,
    functionName: 'register',
    args: [registration],
    value: totalPrice,
  })
  const registerReceipt = await publicClient.waitForTransactionReceipt({ hash: txRegister })
  if (registerReceipt.status !== 'success') {
    fail(
      'register tx',
      `tx ${txRegister} reverted (status=${registerReceipt.status}); see https://explorer.testnet.riselabs.xyz/tx/${txRegister}`,
    )
  }
  console.log(`  register tx mined in block ${registerReceipt.blockNumber} (${txRegister})`)

  // Read back ERC-721 ownerOf via the registrar.
  const erc721Owner = await retryRead(
    async () =>
      (await publicClient.readContract({
        address: riseRegistrar.address,
        abi: riseRegistrar.abi as never,
        functionName: 'ownerOf',
        args: [tokenId],
      })) as Address,
    (o) => o !== zeroAddress,
    'RiseRegistrar.ownerOf',
  )
  assertEq(
    getAddress(erc721Owner),
    getAddress(account.address),
    `REG-01 + REG-02 (commit→reveal→register '${label}')`,
  )

  // --------------------------------------------------------------------
  // Point 4: REG-03 — renew extends expiry
  // --------------------------------------------------------------------
  console.log(`\n[4/5] REG-03 — renew '${label}' for 365 days`)
  const oldExpiry = (await publicClient.readContract({
    address: riseRegistrar.address,
    abi: riseRegistrar.abi as never,
    functionName: 'nameExpires',
    args: [tokenId],
  })) as bigint

  const renewPrice = (await publicClient.readContract({
    address: controller.address,
    abi: controller.abi as never,
    functionName: 'rentPrice',
    args: [label, ONE_YEAR],
  })) as { base: bigint; premium: bigint }

  console.log(
    `  Renewing '${label}' (value: ${renewPrice.base} wei)…`,
  )
  const txRenew = await walletClient.writeContract({
    address: controller.address,
    abi: controller.abi as never,
    functionName: 'renew',
    args: [label, ONE_YEAR, zeroHash as Hex],
    value: renewPrice.base,
  })
  const renewReceipt = await publicClient.waitForTransactionReceipt({ hash: txRenew })
  if (renewReceipt.status !== 'success') {
    fail('renew tx', `tx ${txRenew} reverted (status=${renewReceipt.status})`)
  }
  console.log(`  renew tx mined in block ${renewReceipt.blockNumber} (${txRenew})`)

  const newExpiry = await retryRead(
    async () =>
      (await publicClient.readContract({
        address: riseRegistrar.address,
        abi: riseRegistrar.abi as never,
        functionName: 'nameExpires',
        args: [tokenId],
      })) as bigint,
    (e) => e > oldExpiry,
    'RiseRegistrar.nameExpires (post-renew)',
  )
  if (newExpiry !== oldExpiry + ONE_YEAR) {
    fail(
      'REG-03 (renew extends expiry)',
      `expected newExpiry == oldExpiry + ${ONE_YEAR} (${oldExpiry + ONE_YEAR}), got ${newExpiry} (delta ${newExpiry - oldExpiry})`,
    )
  }
  pass(
    'REG-03 (renew extends expiry)',
    `oldExpiry ${oldExpiry} + ${ONE_YEAR} == newExpiry ${newExpiry}`,
  )

  // --------------------------------------------------------------------
  // Point 5: REG-06 + REG-07 — DefaultReverseRegistrar.setName round-trip
  // --------------------------------------------------------------------
  console.log(
    `\n[5/5] REG-06 + REG-07 — DefaultReverseRegistrar.setName '${label}.rise' + nameForAddr round-trip`,
  )
  const expectedName = `${label}.rise`
  const txSetName = await walletClient.writeContract({
    address: defaultReverseRegistrar.address,
    abi: defaultReverseRegistrar.abi as never,
    functionName: 'setName',
    args: [expectedName],
  })
  const setNameReceipt = await publicClient.waitForTransactionReceipt({ hash: txSetName })
  if (setNameReceipt.status !== 'success') {
    fail('setName tx', `tx ${txSetName} reverted (status=${setNameReceipt.status})`)
  }
  console.log(`  setName tx mined in block ${setNameReceipt.blockNumber} (${txSetName})`)

  const observedName = await retryRead(
    async () =>
      (await publicClient.readContract({
        address: defaultReverseRegistrar.address,
        abi: defaultReverseRegistrar.abi as never,
        functionName: 'nameForAddr',
        args: [account.address],
      })) as string,
    (n) => n.length > 0,
    'DefaultReverseRegistrar.nameForAddr (post-setName)',
  )
  if (observedName !== expectedName) {
    fail(
      'REG-06 + REG-07 (setName → nameForAddr lookup)',
      `expected '${expectedName}', got '${observedName}'`,
    )
  }
  pass(
    'REG-06 + REG-07 (setName → nameForAddr lookup)',
    `nameForAddr(deployer) == '${expectedName}'`,
  )
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2)
  const live = argv.includes('--live') || argv.includes('--exercise')

  const rpc = resolveConfigValue('RISE_TESTNET_RPC', 'rpc')

  console.log('---')
  console.log('RNS Phase 6 D-12 registration verifier')
  console.log(`  chainId      : ${CHAIN_ID}`)
  console.log(`  rpc host     : ${hostOf(rpc)}`)
  console.log(`  deployments  : ${DEPLOYMENTS_DIR}`)
  console.log(`  mode         : ${live ? 'LIVE (state-changing, ~5-10 min)' : 'read-only'}`)
  console.log('---')

  await runReadOnlyChecks({ rpc })

  if (!live) {
    console.log(
      '\nRead-only verification complete (2/5 points). Run with --live to exercise commit→reveal→register.',
    )
    if (process.exitCode && process.exitCode !== 0) {
      console.error('\nVERIFICATION FAILED')
      return
    }
    console.log('\nALL READ-ONLY CHECKS PASSED')
    return
  }

  await runLiveExercise({ rpc })

  if (process.exitCode && process.exitCode !== 0) {
    console.error('\nVERIFICATION FAILED')
    return
  }
  console.log('\n=== Phase 6 closure gate: 5/5 PASS ===')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

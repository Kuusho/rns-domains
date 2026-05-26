import { randomBytes } from 'node:crypto'
import { type Address, type Hex, toHex, zeroAddress, zeroHash } from 'viem'

// Test fixture — commit→wait→register flow for RiseRegistrarController.
//
// Two exports:
//   - `commitRiseName(controller, params)` — generates a fresh secret, builds
//     the Registration struct, calls `commit(makeCommitment(registration))`,
//     advances time past `minCommitmentAge`, and returns the prepared args so
//     the caller can run `register()` themselves (useful when the test asserts
//     on the `register()` write directly).
//   - `registerRiseName(controller, params, opts)` — runs the full
//     commit→wait→register flow in one call. Pays exactly `totalPrice` by
//     default (computed via `controller.read.rentPrice([label, duration])`),
//     or a caller-supplied `value` override (used by the under/overpayment
//     tests).
//
// Both helpers default to 365-day registrations + zero-resolver + empty data
// + reverseRecord=0 + zeroHash referrer — the minimal happy-path shape.

const DEFAULT_DURATION = 365n * 86400n  // 365 days in seconds (>= MIN_REGISTRATION_DURATION=28 days)

export interface CommitRiseNameParams {
  label: string
  ownerAddress: Address
  duration?: bigint
  resolver?: Address
  data?: Hex[]
  reverseRecord?: number
  secret?: Hex
  referrer?: Hex
}

export interface Registration {
  label: string
  owner: Address
  duration: bigint
  secret: Hex
  resolver: Address
  data: Hex[]
  reverseRecord: number
  referrer: Hex
}

export interface CommitRiseNameResult {
  args: Registration
  hash: Hex
}

export interface RegisterOptions {
  value?: bigint
  caller?: { address: Address }
}

/**
 * Build a Registration struct with sensible defaults applied.
 */
function buildRegistration(params: CommitRiseNameParams): Registration {
  const secret =
    params.secret ??
    (toHex(randomBytes(32)) as Hex)
  return {
    label: params.label,
    owner: params.ownerAddress,
    duration: params.duration ?? DEFAULT_DURATION,
    secret,
    resolver: params.resolver ?? zeroAddress,
    data: params.data ?? [],
    reverseRecord: params.reverseRecord ?? 0,
    referrer: params.referrer ?? (zeroHash as Hex),
  }
}

/**
 * Commit a registration on the controller and advance time past
 * minCommitmentAge. Returns the Registration args + commitment hash so the
 * caller can run `register()` separately.
 */
export async function commitRiseName(
  controller: {
    read: {
      makeCommitment: (args: [Registration]) => Promise<Hex>
      minCommitmentAge: () => Promise<bigint>
    }
    write: {
      commit: (args: [Hex], opts?: { account?: { address: Address } }) => Promise<unknown>
    }
  },
  networkHelpers: {
    time: { increase: (seconds: number) => Promise<unknown> }
  },
  params: CommitRiseNameParams,
  opts?: { caller?: { address: Address } },
): Promise<CommitRiseNameResult> {
  const args = buildRegistration(params)
  const hash = await controller.read.makeCommitment([args])
  if (opts?.caller) {
    await controller.write.commit([hash], { account: opts.caller })
  } else {
    await controller.write.commit([hash])
  }
  const minAge = await controller.read.minCommitmentAge()
  await networkHelpers.time.increase(Number(minAge) + 1)
  return { args, hash }
}

/**
 * Full commit→wait→register flow. Returns the Registration args + commitment
 * hash. Pays exactly the price returned by `controller.read.rentPrice()`
 * unless `opts.value` is supplied.
 */
export async function registerRiseName(
  controller: {
    read: {
      makeCommitment: (args: [Registration]) => Promise<Hex>
      minCommitmentAge: () => Promise<bigint>
      rentPrice: (args: [string, bigint]) => Promise<{ base: bigint; premium: bigint }>
    }
    write: {
      commit: (args: [Hex], opts?: { account?: { address: Address } }) => Promise<unknown>
      register: (
        args: [Registration],
        opts: { value: bigint; account?: { address: Address } },
      ) => Promise<unknown>
    }
  },
  networkHelpers: {
    time: { increase: (seconds: number) => Promise<unknown> }
  },
  params: CommitRiseNameParams,
  opts?: RegisterOptions,
): Promise<CommitRiseNameResult> {
  const { args, hash } = await commitRiseName(
    controller,
    networkHelpers,
    params,
    { caller: opts?.caller },
  )

  let value = opts?.value
  if (value === undefined) {
    const price = await controller.read.rentPrice([args.label, args.duration])
    value = price.base + price.premium
  }

  const writeOpts: { value: bigint; account?: { address: Address } } = { value }
  if (opts?.caller) writeOpts.account = opts.caller
  await controller.write.register([args], writeOpts)
  return { args, hash }
}

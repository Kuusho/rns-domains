import { type Address, type Hex, zeroAddress } from 'viem'

// Test fixture — operator-approve + configure flow for SubdomainRegistrar.
//
// One export:
//   - `configureSubdomain(registrar, rns, params)` — runs the two-step listing
//     setup a parent owner must perform: (1) grant the registrar operator
//     approval on the RNS registry (`setApprovalForAll`, Pitfall 4 — the
//     up-front `isApprovedForAll` check in `configure` surfaces a missing
//     approval as `NotApproved`), then (2) call the LOCKED 7-param
//     `configure(parentNode, parentLabelHash, payout, price, enabled, gateToken,
//     minGateBalance)`. Both writes are sent from `parentOwner`.
//
// Parallels test/fixtures/registerRiseName.ts — loose-but-honest typing, sensible
// defaults (enabled = true, no gate). `parentLabelHash` is the 2LD labelhash ==
// the RiseRegistrar ERC-721 token id; it is caller-supplied because on-chain
// namehash inversion is impossible (Plan 07-01 LOCKED surface).

export interface ConfigureSubdomainParams {
  /** The 2LD namehash being listed (e.g. namehash('alice.rise')). */
  parentNode: Hex
  /** The 2LD labelhash == RiseRegistrar token id (e.g. labelhash('alice')). */
  parentLabelHash: Hex
  /** Address that receives the parent share of each sale. */
  payout: Address
  /** Per-subdomain price in native RISE wei (0 allowed — D-05 free subdomains). */
  price: bigint
  /** Listing on/off — defaults to true. */
  enabled?: boolean
  /** Optional ERC-20/721 gate token — defaults to zeroAddress (no gate). */
  gateToken?: Address
  /** Required gate-token balance — defaults to 0n (must pair with gateToken). */
  minGateBalance?: bigint
  /** The parent owner — signs both setApprovalForAll and configure. */
  parentOwner: { address: Address }
}

/**
 * Grant operator approval then list a parent 2LD for subdomain sales.
 * Sends both writes from `params.parentOwner`.
 */
export async function configureSubdomain(
  registrar: {
    address: Address
    write: {
      configure: (
        args: [Hex, Hex, Address, bigint, boolean, Address, bigint],
        opts: { account: { address: Address } },
      ) => Promise<unknown>
    }
  },
  rns: {
    write: {
      setApprovalForAll: (
        args: [Address, boolean],
        opts: { account: { address: Address } },
      ) => Promise<unknown>
    }
  },
  params: ConfigureSubdomainParams,
): Promise<void> {
  const enabled = params.enabled ?? true
  const gateToken = params.gateToken ?? zeroAddress
  const minGateBalance = params.minGateBalance ?? 0n

  await rns.write.setApprovalForAll([registrar.address, true], {
    account: params.parentOwner,
  })
  await registrar.write.configure(
    [
      params.parentNode,
      params.parentLabelHash,
      params.payout,
      params.price,
      enabled,
      gateToken,
      minGateBalance,
    ],
    { account: params.parentOwner },
  )
}

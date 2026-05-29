# RNS — Implementation & Integration Guide

> What has shipped, how it was shipped, the contracts and functions behind each feature, and the
> full frontend integration pathway (viem/wagmi recipes). This document is the bridge between the
> Solidity (the product) and the application layer that consumes it.

**Audience:** frontend/SDK engineers integrating RNS, and anyone auditing what each feature actually
does on-chain.

**Stack:** Hardhat 3 · Bun · Vitest+viem · Solidity 0.8.26 (`evmVersion: paris`) · OpenZeppelin v4.9.3 ·
rocketh. RiseChain testnet chainId `11155931`.

---

## Table of contents

1. [How features map to contracts](#1-how-features-map-to-contracts)
2. [Wiring the client (addresses, ABIs, clients)](#2-wiring-the-client)
3. [Identifiers: label, labelhash, node](#3-identifiers)
4. [Feature: name search & availability](#4-feature-name-search--availability)
5. [Feature: registration (commit → reveal → register)](#5-feature-registration)
6. [Feature: multi-year + tiered discount](#6-feature-multi-year--tiered-discount)
7. [Feature: renewal](#7-feature-renewal)
8. [Feature: resolver records](#8-feature-resolver-records)
9. [Feature: reverse / primary name](#9-feature-reverse--primary-name)
10. [Feature: reserved names & launch allowlist](#10-feature-reserved-names--launch-allowlist)
11. [Feature: subdomain marketplace](#11-feature-subdomain-marketplace)
12. [Feature: on-chain enumeration](#12-feature-on-chain-enumeration)
13. [Feature: global stats](#13-feature-global-stats)
14. [Feature: ERC-7930 interoperable identity](#14-feature-erc-7930-interoperable-identity)
15. [Feature: generative identity (avatars + OG)](#15-feature-generative-identity)
16. [Frontend TODO — what needs shipping/integration](#16-frontend-todo)
17. [Documentation discrepancies to reconcile](#17-documentation-discrepancies)

---

## 1. How features map to contracts

| Feature | Primary contract(s) | Key functions |
|---|---|---|
| Search / availability | `RiseRegistrarController` | `available(label)`, `valid(label)`, `rentPrice(label,duration)`, `reserved(labelhash)`, `commitments(hash)` |
| Registration | `RiseRegistrarController` → `RiseRegistrar` | `makeCommitment`, `commit`, `register` |
| Multi-year + discount | `RiseRegistrarController` + `RiseDurationPriceOracle` | `register`/`renew` (1–10yr cap), oracle `price`/`setDiscounts` |
| Renewal | `RiseRegistrarController` → `RiseRegistrar` | `renew(label,duration,referrer)` |
| Records | `RNSRegistry` + `PublicResolver` (addr/text/contenthash mixins) | `resolver(node)`, `setAddr`, `addr`, `setText`, `text`, `setContenthash`, `multicallWithNodeCheck` |
| Reverse / primary | `ReverseRegistrar`, `DefaultReverseRegistrar` | `setName`, `setNameForAddr`, `node(addr)` |
| Reserved / launch | `RiseRegistrarController` | `reserved`, `setReserved`, `allowlisted`, `setAllowlisted`, `launchActive`, `endLaunch` |
| Subdomains | `SubdomainRegistrar` + `RNSRegistry` | `configure`, `register`, `revokeSubdomain`, `isActive`, `isSubnodeAvailable`, `setApprovalForAll` |
| Enumeration | `RiseRegistrar` (ERC721Enumerable) | `tokensOfOwner(addr)`, `balanceOf`, `totalSupply` |
| Stats | `RiseStats` | `stats()` |
| Interop identity | `RiseInteropResolver` | `interopAddress(node)`, `chainId()` |
| Generative visuals | `frontend/generative/` (off-chain) | `avatarParams(name)`, `renderAvatar`, `renderOg` |

---

## 2. Wiring the client

Contract **addresses** come from the rocketh deploy artifacts in `deployments/<network>/<Name>.json`
(each file has `.address` and `.abi`). Regenerate them with `bun run deploy:local` (local node) or
`bun run deploy:testnet`. Import them into the app at build time, or read them from a small generated
`addresses.ts`.

```ts
import { createPublicClient, createWalletClient, custom, http, getContract } from 'viem'

// RiseChain testnet (chainId 11155931). Replace rpcUrl with the live RPC.
const rise = {
  id: 11155931,
  name: 'RiseChain Testnet',
  nativeCurrency: { name: 'RISE', symbol: 'RISE', decimals: 18 },
  rpcUrls: { default: { http: ['https://<rise-testnet-rpc>'] } },
} as const

export const publicClient = createPublicClient({ chain: rise, transport: http() })
export const walletClient = createWalletClient({ chain: rise, transport: custom(window.ethereum) })

// addresses + abis loaded from deployments/<network>/*.json
import controllerArtifact from '@/deployments/riseTestnet/RiseRegistrarController.json'
export const controller = getContract({
  address: controllerArtifact.address as `0x${string}`,
  abi: controllerArtifact.abi,
  client: { public: publicClient, wallet: walletClient },
})
```

Every recipe below assumes `publicClient`/`walletClient` and the relevant `getContract` instances.
With **wagmi**, swap `publicClient.readContract` → `useReadContract` and `walletClient.writeContract`
→ `useWriteContract` — the `address`/`abi`/`functionName`/`args`/`value` are identical.

---

## 3. Identifiers

Three identifiers recur. Get them right or every call fails silently.

```ts
import { namehash, labelhash } from 'viem/ens' // (also re-exported from 'viem')

const label = 'alice'                  // the 2LD label only (no ".rise")
const node  = namehash('alice.rise')   // bytes32 — used by registry/resolver/subdomain/interop
const tokenId = BigInt(labelhash('alice')) // uint256 — RiseRegistrar ERC-721 token id == keccak256(label)
```

- **`label`** (`string`) — what the controller's `available`/`rentPrice`/`register` take.
- **`tokenId`** (`uint256` = `keccak256(label)`) — what `RiseRegistrar.ownerOf`/`nameExpires`/`available`
  and the subdomain `parentLabelHash` take.
- **`node`** (`bytes32` = `namehash(label + ".rise")`) — what the registry, resolver, reverse, subdomain
  `parentNode`, and interop resolver take.

> **Important:** `tokenId` is a one-way hash of the label — you **cannot** recover the human label
> from a token id on-chain. To render names from `tokensOfOwner` (§12), index the `NameRegistered`
> event (which carries the label string) off-chain, or keep a local label cache.

---

## 4. Feature: name search & availability

**Shipped:** `RiseRegistrarController.available(label)` returns true only when the label is valid
(`strlen ≥ 3`, REG-08), not reserved (REG-09), and unregistered/expired on the base registrar.
`valid(label)` checks only length; `reserved(labelhash)` checks the reserved mapping; `rentPrice`
returns the cost.

**How it was shipped:** the controller composes three checks — `valid()` (rune-aware length via
`StringUtils.strlen`), the `reserved[labelhash]` mapping (Phase-6 reserved list), and the base
registrar's `available(tokenId)` (which respects expiry + the 90-day grace).

```ts
const label = 'alice'
const lh = labelhash(label) // bytes32

const [available, price, isReserved] = await Promise.all([
  controller.read.available([label]),                 // bool — valid + not reserved + unregistered
  controller.read.rentPrice([label, 365n * 86400n]),  // { base, premium } in native wei
  controller.read.reserved([lh]),                      // bool — distinguishes RESERVED from TAKEN
])

// Distinguish the four UI states:
// available && !isReserved          → AVAILABLE
// !available && isReserved          → RESERVED
// !available && !isReserved         → TAKEN (read RiseRegistrar.nameExpires for the date)
// available && launchActive && !allowlisted[addr] → ALLOWLIST_GATED (see §10)
```

To show the expiry/owner of a TAKEN name, read the registrar by token id:

```ts
const expires = await registrar.read.nameExpires([BigInt(lh)]) // uint256 unix seconds (0 = never registered)
const owner   = await registrar.read.ownerOf([BigInt(lh)])     // reverts if expired+burned — wrap in try/catch
```

---

## 5. Feature: registration

**Shipped:** the canonical ENS **commit → reveal → register** flow, anti-front-running, in
`RiseRegistrarController`. The `Registration` struct is identical to ENS's so tooling ports cleanly:

```solidity
struct Registration {
    string  label;        // "alice"
    address owner;        // who receives the name
    uint256 duration;     // seconds (>= 28 days, <= 10 years)
    bytes32 secret;       // client-side random, revealed at register
    address resolver;     // resolver to set (PublicResolver) or address(0)
    bytes[] data;         // resolver multicall calldata to run at registration (or empty)
    uint8   reverseRecord;// bitmask: 1 = .rise primary, 2 = default reverse, 3 = both, 0 = none
    bytes32 referrer;     // referral tag (bytes32(0) if none)
}
```

**How each function affects the flow:**

- `makeCommitment(reg) → bytes32` (**pure**) — hashes the full registration + secret. Recompute it
  on-chain or off-chain; the same inputs must be used at `register`.
- `commit(commitment)` — stores `commitments[commitment] = block.timestamp`. Starts the clock.
- `commitments(commitment) → uint256` (**public mapping**) — the commit timestamp; the frontend reads
  this to drive the 60s countdown and to **recover an interrupted commit** (see the frontend spec's
  D-11). `0` means no open commitment.
- `register(reg) payable` — reverts if the commitment is younger than `minCommitmentAge` or older than
  `maxCommitmentAge`, if underpaid (`InsufficientValue`), if not available (`NameNotAvailable`), or, while
  `launchActive`, if `!allowlisted[msg.sender]` (`NotAllowlisted`). On success it mints via
  `RiseRegistrar.register`, runs `reg.data` against the resolver via `multicallWithNodeCheck`, sets reverse
  records per the bitmask, accrues `cumulativeVolume += base+premium`, and **refunds overpayment last**.

```ts
import { toHex } from 'viem'

const reg = {
  label: 'alice',
  owner: account,
  duration: 365n * 86400n,                                   // 1 year
  secret: toHex(crypto.getRandomValues(new Uint8Array(32))), // KEEP THIS until register
  resolver: publicResolverAddress,
  data: [],                                                   // or encoded record calls (§8)
  reverseRecord: 1,                                           // set alice.rise as primary
  referrer: '0x'.padEnd(66, '0') as `0x${string}`,
}

// 1. commit
const commitment = await controller.read.makeCommitment([reg])
await controller.write.commit([commitment])

// 2. wait minCommitmentAge — drive the countdown from on-chain state (recoverable across reload/devices):
const committedAt = await controller.read.commitments([commitment]) // uint256 seconds
const minAge = await controller.read.minCommitmentAge()              // uint256 (e.g. 60n)
// readyAt = committedAt + minAge ; countdown = readyAt - now(block.timestamp)

// 3. register (after the window opens) — value MUST cover base + premium
const { base, premium } = await controller.read.rentPrice([reg.label, reg.duration])
await controller.write.register([reg], { value: base + premium })
```

> **Cross-device / recovery:** because `commitments[hash]` and `block.timestamp` are on-chain, the wait
> state is reconstructable anywhere — recompute the commitment from the stored Registration inputs +
> secret and read `commitments`. The **secret must be persisted client-side** (localStorage/IndexedDB)
> between commit and register, or the registration cannot be completed.

---

## 6. Feature: multi-year + tiered discount

**Shipped:** registration/renewal for **1–10 years** in one tx, with an owner-tunable discount that
scales with duration, via `RiseDurationPriceOracle` (an `IPriceOracle`) that the controller's `prices`
reference points at.

**How it was shipped (RF-1):** the controller's `prices` is `immutable`, so the discount could not be
hot-swapped — Phase 8 redeployed the controller pointing at the new oracle. Because both `register` and
`renew` price through the same `prices.price(label, expires, duration)` seam, **renew automatically gets
the same discount as register** with zero extra controller logic. The 1–10yr bound is enforced on the
controller path (`MAX_REGISTRATION_DURATION = 10*365 days`, `DurationTooLong`); the 28-day floor
(`MIN_REGISTRATION_DURATION`) is untouched, and the oracle returns 0% discount below 1 year so short
registrations price identically to the flat oracle.

**Discount schedule** (`uint16[11] discountBps`, indexed by whole years 1–10; default, owner-tunable up
to the immutable `MAX_DISCOUNT_BPS = 2000`):

| Years | 1 | 2–3 | 4–5 | 6–9 | 10 |
|---|---|---|---|---|---|
| Discount | 0% | 5% | 10% | 15% | 20% |

```ts
// Quote any duration — the discount is already baked into rentPrice():
const fiveYears = 5n * 365n * 86400n
const { base, premium } = await controller.read.rentPrice(['alice', fiveYears]) // 10% off at 5yr

// Read the live tier table for a pricing UI:
const discounts = await durationOracle.read.discountBps() // uint16[11], index 1..10 = bps
const cap = await durationOracle.read.MAX_DISCOUNT_BPS()   // 2000n

// Owner-only: retune tiers (each entry must be <= MAX_DISCOUNT_BPS or it reverts DiscountTooHigh)
await durationOracle.write.setDiscounts([[0, 0, 500, 500, 1000, 1000, 1500, 1500, 1500, 1500, 2000]])
```

The same `duration` (1–10yr) is passed to `register` (§5) and `renew` (§7); no separate "multi-year"
entry point exists — duration is just a parameter.

---

## 7. Feature: renewal

**Shipped:** `RiseRegistrarController.renew(label, duration, referrer)` extends a name's expiry. Anyone
can renew any name (you don't have to own it). Priced through the same discount oracle (§6), and accrues
`cumulativeVolume`.

```ts
const { base } = await controller.read.rentPrice(['alice', 365n * 86400n]) // renew has no premium
await controller.write.renew(['alice', 365n * 86400n, referrerTag], { value: base })

// Expiry + grace for the UI:
const expires = await registrar.read.nameExpires([tokenId]) // uint256
const GRACE   = await registrar.read.GRACE_PERIOD()         // 90 days in seconds
// expired-but-renewable while now < expires + GRACE ; claimable by others after.
```

---

## 8. Feature: resolver records

**Shipped:** `PublicResolver` with profile mixins — `addr` (multi-coin), `text`, `contenthash`, plus
ABI/interface/name/pubkey. A name's resolver is whatever `RNSRegistry.resolver(node)` returns (set to
`PublicResolver` at registration). Writes are gated to the name's owner/operator.

**Key functions:**

- `setAddr(node, address)` / `addr(node) → address` — the primary EVM address (COIN_TYPE_ETH).
- `setAddr(node, coinType, bytes)` / `addr(node, coinType) → bytes` — multi-coin (ENSIP-11/19).
- `setText(node, key, value)` / `text(node, key) → string` — `avatar`, `url`, `com.twitter`, `description`, …
- `setContenthash(node, bytes)` / `contenthash(node) → bytes` — IPFS/Arweave/IPNS.
- `multicallWithNodeCheck(node, bytes[])` — batch multiple record writes for one node in a single tx
  (this is also the path the controller uses for `reg.data` at registration — Pitfall 4: resolver init
  is multicall-only).

**Read a name's records:**

```ts
const resolverAddr = await registry.read.resolver([node]) // resolve which resolver holds this name's records
const resolver = getContract({ address: resolverAddr, abi: publicResolverAbi, client: publicClient })

const [addr, avatar, twitter] = await Promise.all([
  resolver.read.addr([node]),
  resolver.read.text([node, 'avatar']),
  resolver.read.text([node, 'com.twitter']),
])
```

**Bundle record writes (the D-09 "set avatar + primary in one tx" pattern):**

```ts
import { encodeFunctionData } from 'viem'

const calls = [
  encodeFunctionData({ abi: publicResolverAbi, functionName: 'setAddr', args: [node, account] }),
  encodeFunctionData({ abi: publicResolverAbi, functionName: 'setText', args: [node, 'avatar', 'https://…'] }),
]
await resolver.write.multicallWithNodeCheck([node, calls])

// …or pass `calls` as Registration.data to set them DURING registration (§5) — one transaction total.
```

---

## 9. Feature: reverse / primary name

**Shipped:** the classic `addr.reverse` model. `ReverseRegistrar.setName(name)` sets the caller's primary
`.rise` name; `DefaultReverseRegistrar.setName(name)` sets a chain-default reverse name. The controller
can set either (or both) at registration via the `reverseRecord` bitmask (§5).

```ts
await reverseRegistrar.write.setName(['alice.rise'])          // primary name for msg.sender
await defaultReverseRegistrar.write.setName(['alice.rise'])   // default.reverse

// Resolve an address → its primary name (reverse lookup):
const reverseNode = await reverseRegistrar.read.node([someAddress]) // bytes32
const resolverAddr = await registry.read.resolver([reverseNode])
const primaryName = await getContract({ address: resolverAddr, abi: nameResolverAbi, client: publicClient })
  .read.name([reverseNode]) // "alice.rise"
```

---

## 10. Feature: reserved names & launch allowlist

**Shipped — and different from the original frontend spec (see §17).** The controller enforces two
launch controls:

- **Reserved names:** `reserved[labelhash] → bool` (owner-managed via `setReserved(labelhash, bool)`).
  24 labels were seeded pre-handoff. Reserved labels return `available == false`.
- **Launch allowlist:** a **simple owner-managed per-address mapping** — `allowlisted[address] → bool`,
  set via `setAllowlisted(address, bool)`. While `launchActive == true`, `register` reverts
  `NotAllowlisted` for any `msg.sender` not in the mapping. `endLaunch()` (one-shot, owner-only) flips
  `launchActive` to false and opens registration to everyone.

> There is **no merkle root and no merkle proof.** The `/allowlist` verifier reads the on-chain mapping
> directly — no proof needs to be delivered to or submitted by users.

```ts
// Allowlist verifier (no wallet needed — pure read):
const isAllowed = await controller.read.allowlisted([addressToCheck]) // bool
const launchOn  = await controller.read.launchActive()                 // bool

// Reserved explainer:
const isReserved = await controller.read.reserved([labelhash('vitalik')])

// Owner-only admin:
await controller.write.setAllowlisted([userAddr, true])
await controller.write.setReserved([labelhash('rise'), true])
await controller.write.endLaunch() // opens public registration; reverts if already ended
```

**Launch-state UI:** derive from `launchActive` — `true` = allowlist phase (gate registration on
`allowlisted[connected]`), `false` = public.

---

## 11. Feature: subdomain marketplace

**Shipped:** `SubdomainRegistrar` lets a `.rise` 2LD owner monetize subdomains, ported from the audited
`wei-names` epoch-invalidation pattern (no NameWrapper). It **never takes custody** — it writes subnodes
via `RNSRegistry.setSubnodeRecord` using operator approval.

**How it was shipped:** the parent owner first grants the registrar operator approval, then `configure`s
a listing. Buyers `register` a subdomain by paying the listed price; revenue is split (protocol fee →
parent payout → refund) with **zero funds pooled**. Subdomains are **lazily invalidated**: `isActive`
returns false once the parent's owner snapshot changes or the parent's `nameExpires` falls below the
configure-time snapshot (so a parent's subdomains die when the parent lapses + re-registers, but survive
a renewal). The parent's `parentLabelHash` is cryptographically bound to `parentNode`
(`keccak256(riseNode, parentLabelHash) == parentNode`, `ParentLabelMismatch`).

**Listing (parent owner):**

```ts
// 1. one-time: approve the registrar to write your subnodes
await registry.write.setApprovalForAll([subdomainRegistrarAddress, true])

// 2. list alice.rise for sales
await subdomainRegistrar.write.configure([
  namehash('alice.rise'),      // parentNode
  labelhash('alice'),          // parentLabelHash (your 2LD token id)
  payoutAddress,               // who receives the parent share
  parseEther('0.01'),          // price per subdomain (native wei; 0 allowed)
  true,                        // enabled
  '0x0000000000000000000000000000000000000000', // gateToken (0 = no gate)
  0n,                          // minGateBalance
])
```

**Buying (anyone):**

```ts
const subnode = await subdomainRegistrar.read.isSubnodeAvailable([
  namehash('alice.rise'), labelhash('bob'),
]) // bool — guard before buying

await subdomainRegistrar.write.register(
  [namehash('alice.rise'), 'bob', buyerAddress], // → bob.alice.rise minted to buyerAddress
  { value: parseEther('0.01') },
)
```

**Token-gated listing:** pass `gateToken` (ERC-20 or ERC-721) + `minGateBalance` to `configure`; buyers
below the balance revert `GateFailed`. A malicious/non-conforming token can't brick the path (safe
staticcall returns 0).

**Parent controls:** `disable(parentNode)`, `revokeSubdomain(parentNode, labelHash, newOwner)` (reverts
`NotSold` if there's no sale record). **Protocol owner:** `setFeeBps(bps)` (≤ `FEE_CAP_BPS` = 1000 / 10%),
`setFeeRecipient(addr)`.

**Status reads for UI:** `isActive(parentNode, labelHash)` (logical liveness — display "active/expired"),
`isSubnodeAvailable(parentNode, labelHash)` (can it be sold). Listen to `SubdomainConfigured`,
`SubdomainRegistered`, `SubdomainRevoked` events.

> **Epoch semantics for the UI:** invalidation is *logical, not physical* — the registry `owner(subnode)`
> record persists after a parent lapses. Always read `isActive`/`isSubnodeAvailable` as the source of
> truth; never infer liveness from `registry.owner(subnode)`.

---

## 12. Feature: on-chain enumeration

**Shipped:** `RiseRegistrar` inherits OZ `ERC721Enumerable`, so `tokensOfOwner(address)` returns every
token id an address holds — the `/me` dashboard works **with no subgraph**.

```ts
const ids = await registrar.read.tokensOfOwner([account]) // uint256[] — token ids (== labelhashes)
const supply = await registrar.read.totalSupply()         // live un-burned count
```

**Semantics (D-02):** `tokensOfOwner` reflects **raw ERC-721 ownership** — an expired-but-not-yet-
re-registered name still appears under its last owner until someone re-registers it. Cross-check
`nameExpires(id)` to badge expired names.

> **Label recovery:** ids are `keccak256(label)` and cannot be reversed on-chain. To show human names,
> map each id → label via the `NameRegistered` event log (it carries the label string), a local cache, or
> an indexer. This is the one place a light off-chain index still helps, even though ownership itself is
> now fully on-chain.

---

## 13. Feature: global stats

**Shipped:** `RiseStats.stats()` returns all four lifetime counters plus live supply in one call, reading
only plain public counters (never a reverting getter):

```solidity
struct Stats {
    uint256 registrations;    // lifetime registrations
    uint256 renewals;         // lifetime renewals
    uint256 totalSubdomains;  // lifetime subdomain SALES (not a live active count)
    uint256 cumulativeVolume; // native RISE paid through the controller (register + renew)
    uint256 currentSupply;    // live un-burned name count
}
```

```ts
const s = await stats.read.stats()
// s.registrations, s.renewals, s.totalSubdomains, s.cumulativeVolume, s.currentSupply
```

`cumulativeVolume` counts the **priced** amount (base+premium / base), never `msg.value`, so refunds
don't inflate it. Use it directly for a `/stats` page — no event aggregation required.

---

## 14. Feature: ERC-7930 interoperable identity

**Shipped:** `RiseInteropResolver.interopAddress(node)` encodes a name's primary address as an ERC-7930
interoperable address — the `.rise → account → ERC-8004` spine. Standalone read-only view; no resolver
modification.

**Wire format** (chainId constructor-injected, never hardcoded — D-10):
`Version(0x0001) ‖ ChainType(0x0000 = EVM) ‖ ChainRefLen ‖ ChainRef(minimal big-endian) ‖ AddrLen(0x14) ‖ Addr(20)`.
RiseChain testnet (chainId 11155931) → chain reference `0xaa39db`.

```ts
const interop = await interopResolver.read.interopAddress([namehash('alice.rise')]) // bytes
const chainId = await interopResolver.read.chainId()                                 // 11155931n
```

**Reverts** `NoResolver(node)` if the name has no resolver and `NoPrimaryAddress(node)` if `addr(node) == 0`
(D-11 — it never emits a meaningless zero-address blob). Handle both in the UI as "no interop identity yet."

---

## 15. Feature: generative identity

**Shipped (off-chain):** a deterministic, name-derived visual identity system in `frontend/generative/` —
one algorithm produces both the in-app **avatar** and the 1200×630 **OG link-preview card**. Derived from
`keccak256(namehash(name))`, so the same name always renders the same art with no stored image.

```ts
// 6 hash bytes → visual params (the portable, single-source-of-truth core)
b     = keccak256(namehash(name)).slice(0, 6)
hue1  = b[0]·360/255 ; hue2 = (hue1 + 30 + b[1]%90)%360
comp  = b[2]%4   // radial | linear | banded | split
glyph = b[3]%6   // sun | aperture | orbit | arc | diamond | chain
rot   = b[4]·360/255 ; sat = 55 + b[5]%25
```

**Status & how to integrate:** today it is a **pure-SVG reference generator** (`bun run
frontend/generative/generate.ts` → 12 avatars + OG cards + a gallery). It is **not yet on-chain** (`tokenURI`
is not overridden) and is structured to port to a production `@vercel/og` (satori) edge route — keep
`avatarParams()` as the single source of truth and render it twice (avatar route + OG route). See the
satori-porting checklist in `frontend/generative/README.md` (no `<filter>`/blur, fonts loaded explicitly,
no conic gradients). The geometry math ports unchanged.

---

## 16. Frontend TODO

What the frontend must build/integrate to consume the shipped contracts. **P0** = required for a
functional dApp; **P1** = differentiation surface; **P2** = polish. (These are mirrored into
`frontend/SPEC.md` §5.5.)

### Core flows (P0)
- [ ] **Client wiring** — chain config (11155931), address/ABI import from `deployments/`, public+wallet clients, wrong-chain banner.
- [ ] **Search/availability** — `available` + `valid` + `reserved` + `rentPrice`; resolve the 4 states (AVAILABLE / TAKEN / RESERVED / ALLOWLIST_GATED).
- [ ] **Commit→reveal→register** — `makeCommitment` → `commit` → countdown from `commitments[hash]` + `minCommitmentAge` → `register` with `value = base+premium`. **Persist the `secret` client-side**; support recovery from an interrupted commit.
- [ ] **Multi-year selector** — 1–10yr picker; quote via `rentPrice(label, duration)`; show the tier discount from `discountBps`.
- [ ] **Renewal** — `renew(label, duration, referrer)`; expiry + grace display from `nameExpires` + `GRACE_PERIOD`.
- [ ] **Records editor** — read via `registry.resolver(node)` → resolver `addr`/`text`/`contenthash`; write via `multicallWithNodeCheck`; bundle into registration `data[]` where possible.
- [ ] **Reverse/primary name** — `ReverseRegistrar.setName` / `DefaultReverseRegistrar.setName`; reverse lookup for display; set during registration via `reverseRecord` bitmask (1/2/3).
- [ ] **Launch allowlist gate** — read `launchActive` + `allowlisted[connected]`; gate the register CTA. **No merkle proof** — direct mapping read (corrects the old spec, §17).
- [ ] **Admin** — owner-gated `setReserved`, `setAllowlisted`, `endLaunch`, oracle `setRentPrices`/`setDiscounts`, subdomain `setFeeBps`/`setFeeRecipient`.

### v1.1 surface (P1) — new since the original frontend spec
- [ ] **`/me` dashboard via on-chain enumeration** — `tokensOfOwner(account)` (no subgraph). Build a label cache from `NameRegistered` events to render names from ids.
- [ ] **`/stats` page** — single `RiseStats.stats()` read (registrations/renewals/subdomains/volume/supply).
- [ ] **Subdomain marketplace UI** — parent: `setApprovalForAll` → `configure` (price, payout, gate, enable) → `disable`/`revokeSubdomain`. Buyer: `isSubnodeAvailable` guard → `register` with value. Show split (fee/payout), gate requirement, and `isActive` liveness. Listen to `Subdomain*` events.
- [ ] **Interop identity display** — `interopAddress(node)` on profiles (the agent/cross-chain story); handle `NoResolver`/`NoPrimaryAddress`.
- [ ] **Generative avatar + OG** — port `frontend/generative/avatarParams()` into an avatar component + a `@vercel/og` route for `/name/[label]` cards (satori checklist in the generative README).

### Indexing / infra
- [ ] **Event indexing** — `NameRegistered`/`NameRenewed` (label↔id map + live feed), `Subdomain*`. Direct event scan is fine pre-launch; add an indexer at scale (ownership itself no longer needs one — §12).
- [ ] **OG image edge route** — `@vercel/og` (satori) rendering the name + avatar + brand.

See `frontend/SPEC.md` for brand, screens, motion, and the full feature matrix.

---

## 17. Documentation discrepancies

Surfaced while verifying this guide against the shipped code — reconcile these in the older docs:

1. **Allowlist is per-address, not merkle.** `frontend/SPEC.md` (F-11, F-29, §6.10) and the Phase-6 note
   in `.planning/PROJECT.md` describe a "merkle proof allowlist / allowlistRoot." The shipped
   `RiseRegistrarController` uses a plain `allowlisted[address]` mapping + `setAllowlisted` + `endLaunch`
   (no merkle root, no proof). The `/allowlist` verifier should read the mapping directly. **This guide
   and `frontend/SPEC.md` §5.5 reflect the actual mechanism; F-11/F-29/§6.10 should be updated.**
2. **`tokensOfOwner` removes the subgraph dependency for ownership.** `frontend/SPEC.md` F-12 assumes a
   subgraph for owned-name lookups; Phase 8 made this on-chain. A light indexer is still useful only for
   the id→label map and live feeds (§12).
3. **Generative identity is off-chain today.** It is a name-derived SVG generator, not an on-chain
   `tokenURI`. Docs (incl. the README) frame it as such; on-chain `tokenURI` rendering would be a future
   integration.

---

*Generated 2026-05-29 from the Phase 1–8 codebase. Contract function references cite the shipped
Solidity; see `contracts/` for the source of truth.*

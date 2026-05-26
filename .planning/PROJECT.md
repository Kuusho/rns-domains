# RNS — RiseChain Name Service

## What This Is

RNS is an ENS-style on-chain name service for **`.rise` names on RiseChain**. It lets any
address register a human-readable `.rise` name, point it at records (addresses, text,
contenthash, …), and set a primary (reverse) name. RNS is the naming/identity primitive for
R2 Markets' agentic-infrastructure layer — it serves the `.rise name → account → ERC-8004
identity` spine that R2 agents need for persistent, human-readable handles.

It is a **deliberate, phased fork** of the classic ENS contracts architecture
(`ensdomains/ens-contracts` v1.7.0): study the read-only reference, then re-create the
contracts phase by phase along the dependency graph, applying RiseChain-specific changes as
each contract comes in. Each phase compiles, deploys, and passes a verification gate before
the next begins.

## Core Value

A user can **commit → reveal → register a `.rise` name end-to-end, pay, renew, resolve its
records, and set a primary (reverse) name** — delivered as a clean, correct fork of the ENS
contract architecture on RiseChain. If everything else is deferred, this end-to-end name
service must work.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- [x] Repo scaffold — Hardhat 3 + Bun project; shared utility libraries (`NameCoder`, `BytesUtils`, `HexUtils`, `StringUtils`, `ENSIP19`); per-phase interface-porting policy; Vitest + viem test harness — *Validated in Phase 1: Repo Scaffold & Shared Libraries (`bun run compile` clean, 350/350 utility tests pass)*
- [x] Naming layer — `RNSRegistry` + `RNS` (frozen interface) + `RNSControllable` + `RNSRoot` + `RNSRootSecurityController`; root-node ownership wired to `RNSRoot`; `rocketh` deploy harness; testnet smoke deploy live — *Validated in Phase 2: Naming Layer Foundation (372/372 local conformance suite passes + on-chain D-05 smoke deploy on RISE testnet chainId 11155931, contracts at `0x1E413C…fdEDcAB` / `0x9709C4…6685` / `0x8a3578…aAaCA`; `Registry.owner(0x0) == RNSRoot` and `setSubnodeOwner` round-trip confirmed; CORE-01..05 closed)*
- [x] `.rise` registrar — `RiseRegistrar` (ERC-721 `"RiseChain Name Service"` / `".rise"`, `baseNode = namehash('rise')`), `RegistrarSecurityController` (un-prefixed, inherits `RNSControllable`); `.rise` TLD assigned via root-mediated activation gate — *Validated in Phase 3: The .rise Registrar (33/33 Phase-3 tests + 372/372 prior-phase regression suite green; operator-confirmed `bun run deploy:local` with `TLD-01: PASS ✓` against fresh `hardhat node`; Pitfall 2 enforced — `grep -c "account: owner" deploy/riseregistrar/00_setup_rise_registrar.ts == 0`; TLD-01..08 closed; code review 0 critical / 2 warning / 4 info)*
- [x] Resolution — resolver `profiles/` (9 mixins + ExtendedResolver) + `PublicResolver` (3-slot constructor, 2-tier auth per D-06, `ReverseClaimer` dropped per D-07) + `RiseOwnedResolver` (single-owner, ENSIP-10 dispatcher, `DataResolver` excluded per Pitfall 9); `.rise` node's resolver slot wired via `RegistrarSecurityController.setRegistrarResolver` signed by `owner` (Pitfall 2) — *Validated in Phase 4: Resolution (190/190 Phase-4 tests + 405/405 prior-phase regression suite green; operator-confirmed `bun run deploy:local` with `rns.resolver(namehash('rise')) == 0xCf7Ed3AccA…fb0Fc9 == RiseOwnedResolver.address` on local Hardhat node — RES-07 closed; RES-01..07 closed; code review 0 critical / 2 warning / 6 info — all reference-port-fidelity inheritance)*
- [x] Pricing — `RisePriceOracle`: flat, owner-settable, native-token-denominated per-length pricing satisfying `IPriceOracle` (interface ported to `contracts/registrar-controller/` per D-07; `uint256[5] rentPrices` storage with named `rentPrice(uint256)` getter; `setRentPrices` bulk setter w/ `RentPriceChanged` snapshot event; `_premium` virtual hook reserved; ERC-165 advertising `IERC165 || IPriceOracle`; deploy script signs deploy + `transferOwnership(owner)` with `deployer` per D-11; zero Chainlink/USD references) — *Validated in Phase 5: Pricing (25/25 unit tests + 5/5 IntegrationPricing tests + 595/595 prior-phase regression suite green; in-process `loadAndExecuteDeployments` evidence accepted as closure per user decision 2026-05-26 — testnet deploy deferred to Phase 6; PRICE-01..05 closed; code review 0 critical / 0 warning / 3 info — all reference-port-fidelity stylistic notes)*

### Active

<!-- Current scope. Building toward these. The phased fork plan (spec §7). -->


- [ ] Reverse resolution — `ReverseRegistrar` + `DefaultReverseRegistrar` (the simple `addr.reverse` model)
- [ ] Public registration — `RiseRegistrarController`: commit-reveal, payment, renewal, optional resolver-record multicall, optional reverse-record setup, **reserved-name list + launch allowlist**
- [ ] Convenience layer — `BatchGatewayProvider` + `UniversalResolver`, `StaticBulkRenewal` (Phase 6, optional)
- [ ] Subdomain wrapping — `NameWrapper` + `ERC1155Fuse` + `StaticMetadataService` (Phase 7, optional)

All Active requirements are hypotheses until shipped and validated. Detailed, testable
requirements with REQ-IDs live in `.planning/REQUIREMENTS.md`.

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Registration **frontend app** — separate track, post-contracts
- **JS/TS SDK** — separate track, post-contracts
- **DNSSEC oracle + DNS-name import** — dropped entirely; no analog for a greenfield `.rise` namespace
- **L1-readable / cross-chain reverse resolution** (ENSIP-19 machinery: `L2ReverseRegistrar`, `ChainReverseResolver`) — RiseChain is the home chain for `.rise`; revisit only if cross-chain reverse is needed
- **ENSv2 / Namechain** (ENS's own L2 design) — too entangled with cross-chain machinery for a single-chain `.rise` service
- **Migration scaffolding** (`ENSRegistryWithFallback`, `MigrationHelper`, legacy controllers, `FIFSRegistrar`) — dropped; nothing to migrate from on a greenfield chain
- **Chainlink USD price conversion** — RiseChain has no ETH/USD feed at the hardcoded mainnet address; native-token pricing used instead
- **Real price feeds** (Pyth / RedStone / native oracle) — post-MVP upgrade; the `IPriceOracle` interface is preserved so the controller is unchanged when added
- **ERC-8004 identity registry & EAS reputation** — downstream R2 concerns that consume RNS resolution; not built here

## Context

- **Fork source:** the classic ENS contracts architecture — registry / registrar / controller
  / resolver / reverse-registrar — from `ensdomains/ens-contracts` v1.7.0, cloned read-only at
  `reference/ens-contracts/`. RNS does **not** fork ENSv2 / Namechain.
- **Fork method:** study the reference, re-create contracts phase by phase ordered by the
  deploy-script dependency graph. Do not copy the repo wholesale. Each phase compiles,
  deploys, and verifies before the next begins.
- **RiseChain environment:** greenfield — no existing name service. RiseChain is Cancun-class
  (EVM ≥ Paris). ENS uses `block.timestamp` throughout, which is reliable here.
- **Dependency chain (spec §5)** — the hard build order:
  `RNSRegistry → Root → RootSecurityController → RiseRegistrar → RegistrarSecurityController →
  {RisePriceOracle (independent), OwnedResolver, ReverseRegistrar + DefaultReverseRegistrar,
  RiseRegistrarController → PublicResolver}`.
- **Parent track:** R2 Markets → RiseChain pivot (Linear `COO-16`, `COO-38`, `COO-40`). RNS is
  the naming layer the `ERC-8004` identity registry and EAS reputation hang off.
- **Strategy:** being first means RNS can become the *de-facto canonical* name service of
  RiseChain (the address wallets/explorers/SDKs point at) — an adoption outcome powered by the
  team's RiseChain relationship. The build itself just needs to ship clean, on time, correct.
- **References kept open while forking:** `reference/ens-contracts/deploy/` (the dependency
  arrays), `contracts/ethregistrar/ETHRegistrarController.sol` (the `ETH_NODE` constant + `.eth`
  strings), `contracts/ethregistrar/StablePriceOracle.sol` (the Chainlink seam).

## Constraints

- **Tech stack**: Hardhat 3 + Bun + Vitest/viem, Solidity 0.8.26 (`evmVersion: paris`) —
  keep ENS's toolchain unchanged. The ENS deploy scripts *are* the dependency graph and the
  tests mirror the contracts one-to-one; switching to Foundry would mean rewriting every
  script and test (pure friction, added error surface). `NameWrapper` is pinned to Solidity
  0.8.17 in the reference — relevant only if Phase 7 is built.
- **Build order**: contracts must be created in the spec §5 dependency-chain order. Nothing
  can be deployed before its dependency.
- **Phase gates**: each phase compiles, deploys, and passes its "Done when" verification gate
  before the next starts. Phases 1–5 verify on a **local Hardhat network** (Phase 5 closes on
  in-process `loadAndExecuteDeployments` evidence — boundary revised 2026-05-26); Phase 6
  (MVP complete) deploys to the **RiseChain testnet** for end-to-end verification.
- **RiseChain fork edits**: `.eth → .rise` (TLD strings, `ETH_NODE` constant recompute,
  deploy-script namehashes); drop the Chainlink dependency for native-token pricing; keep the
  simple `addr.reverse` reverse model; audit/replace hardcoded addresses (Chainlink feed,
  mainnet owner in `rocketh.ts`, Safe/CREATE3 L2 branch, `Multicall3`).
- **Correctness**: "ship clean, on time, and correct" — the contracts are the product;
  canonical adoption is a separate, downstream outcome.

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Fork the classic ENS architecture, not ENSv2 / Namechain | ENSv2 is entangled with cross-chain machinery a single-chain `.rise` service doesn't need | — Pending |
| Keep ENS's toolchain — Hardhat 3 + Bun + Vitest/viem, Sol 0.8.26 (`paris`) | Deploy scripts are the dependency graph; tests mirror contracts 1:1; a Foundry migration is pure friction | — Pending |
| Phased fork — re-create contract-by-contract, never copy wholesale | Each phase compiles/deploys/verifies; RiseChain edits applied in a controlled way per contract | — Pending |
| Full 8-phase roadmap — Phases 6 (UniversalResolver/bulk renewal) and 7 (NameWrapper) included, flagged optional | Whole arc visible upfront; 6–7 remain post-MVP and conditional | — Pending |
| `RiseRegistrarController` gains a reserved-name list **and** a launch allowlist | RNS aspires to be the de-facto canonical service — protect brand/system names from a launch land-grab and stage a controlled launch window | — Pending |
| `RisePriceOracle` — flat, owner-settable, native-token-denominated pricing; premium auction deferred | RiseChain has no Chainlink feed; flat pricing satisfies `IPriceOracle`; the exponential post-expiry premium is Phase 6 work | — Validated in Phase 5 |
| Keep `RootSecurityController` + `RegistrarSecurityController` | Small contracts; emergency controls (TLD removal, controller gating) that pair naturally with the controlled-launch policy | — Pending |
| Phases 1–5 verify on local Hardhat; Phase 6 (MVP gate) deploys to RiseChain testnet | Boundary revised 2026-05-26 (was: "Phase 5 deploys to testnet"). Phase 5 closes on in-process `loadAndExecuteDeployments` evidence; one real testnet deploy proves end-to-end at the MVP gate (Phase 6) where the controller, payment, and reverse registrar all converge | — Pending (Phase 6) |
| Native-token pricing instead of Chainlink USD conversion | No Chainlink ETH/USD feed exists at the hardcoded mainnet address on RiseChain | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-26 after Phase 5 (Pricing) completion — 4/4 plans shipped, PRICE-01..05 verified locally (25 unit + 5 integration tests + 595/595 prior-phase regression = 625/625 in-process green) via `loadAndExecuteDeployments` rocketh-in-test fixture; testnet-deploy boundary revised — Phase 5 closes on in-process evidence, testnet deploy moves to Phase 6 (MVP gate)*

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

## Current Milestone: v1.1 — Beyond the Fork

**Goal:** Move RNS past a clean ENS fork into differentiated territory — a monetizable
subdomain marketplace plus the protocol enrichments that make the frontend and the agentic
identity story real — using features validated by the `mega-names` (MegaETH) and audited
`wei-names` reference codebases.

**Target features:**
- Subdomain marketplace (`SubdomainRegistrar`) — owner-priced subdomain sales, revenue split, token-gating, epoch invalidation (supersedes NameWrapper)
- ERC-721 enumeration + global stat counters on the registrar (powers the frontend without a subgraph)
- ERC-7930 interoperable-address resolution (the `.rise → account → ERC-8004` spine)
- Multi-year registration (1–10 years) with tiered discounts

**Key context:** v1.0 (the MVP fork, Phases 1–6) is complete. These additions are net-new
scope, not part of the original phased-fork plan. The subdomain registrar is purely additive
(the registry already exposes `setSubnodeOwner`). Engineering caveat carried from the
reference analysis: the reference contracts use `tstore` reentrancy guards (Cancun EVM); RNS
pins `evmVersion: paris`, so the port swaps to a storage-based `ReentrancyGuard`.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- [x] Repo scaffold — Hardhat 3 + Bun project; shared utility libraries (`NameCoder`, `BytesUtils`, `HexUtils`, `StringUtils`, `ENSIP19`); per-phase interface-porting policy; Vitest + viem test harness — *Validated in Phase 1: Repo Scaffold & Shared Libraries (`bun run compile` clean, 350/350 utility tests pass)*
- [x] Naming layer — `RNSRegistry` + `RNS` (frozen interface) + `RNSControllable` + `RNSRoot` + `RNSRootSecurityController`; root-node ownership wired to `RNSRoot`; `rocketh` deploy harness; testnet smoke deploy live — *Validated in Phase 2: Naming Layer Foundation (372/372 local conformance suite passes + on-chain D-05 smoke deploy on RISE testnet chainId 11155931, contracts at `0x1E413C…fdEDcAB` / `0x9709C4…6685` / `0x8a3578…aAaCA`; `Registry.owner(0x0) == RNSRoot` and `setSubnodeOwner` round-trip confirmed; CORE-01..05 closed)*
- [x] `.rise` registrar — `RiseRegistrar` (ERC-721 `"RiseChain Name Service"` / `".rise"`, `baseNode = namehash('rise')`), `RegistrarSecurityController` (un-prefixed, inherits `RNSControllable`); `.rise` TLD assigned via root-mediated activation gate — *Validated in Phase 3: The .rise Registrar (33/33 Phase-3 tests + 372/372 prior-phase regression suite green; operator-confirmed `bun run deploy:local` with `TLD-01: PASS ✓` against fresh `hardhat node`; Pitfall 2 enforced — `grep -c "account: owner" deploy/riseregistrar/00_setup_rise_registrar.ts == 0`; TLD-01..08 closed; code review 0 critical / 2 warning / 4 info)*
- [x] Resolution — resolver `profiles/` (9 mixins + ExtendedResolver) + `PublicResolver` (3-slot constructor, 2-tier auth per D-06, `ReverseClaimer` dropped per D-07) + `RiseOwnedResolver` (single-owner, ENSIP-10 dispatcher, `DataResolver` excluded per Pitfall 9); `.rise` node's resolver slot wired via `RegistrarSecurityController.setRegistrarResolver` signed by `owner` (Pitfall 2) — *Validated in Phase 4: Resolution (190/190 Phase-4 tests + 405/405 prior-phase regression suite green; operator-confirmed `bun run deploy:local` with `rns.resolver(namehash('rise')) == 0xCf7Ed3AccA…fb0Fc9 == RiseOwnedResolver.address` on local Hardhat node — RES-07 closed; RES-01..07 closed; code review 0 critical / 2 warning / 6 info — all reference-port-fidelity inheritance)*
- [x] Pricing — `RisePriceOracle`: flat, owner-settable, native-token-denominated per-length pricing satisfying `IPriceOracle` (interface ported to `contracts/registrar-controller/` per D-07; `uint256[5] rentPrices` storage with named `rentPrice(uint256)` getter; `setRentPrices` bulk setter w/ `RentPriceChanged` snapshot event; `_premium` virtual hook reserved; ERC-165 advertising `IERC165 || IPriceOracle`; deploy script signs deploy + `transferOwnership(owner)` with `deployer` per D-11; zero Chainlink/USD references) — *Validated in Phase 5: Pricing (25/25 unit tests + 5/5 IntegrationPricing tests + 595/595 prior-phase regression suite green; in-process `loadAndExecuteDeployments` evidence accepted as closure per user decision 2026-05-26 — testnet deploy deferred to Phase 6; PRICE-01..05 closed; code review 0 critical / 0 warning / 3 info — all reference-port-fidelity stylistic notes)*
- [x] Reverse resolution — `ReverseRegistrar` (Ownable + `RNSControllable` + `IReverseRegistrar`, `node(addr) = keccak(ADDR_REVERSE_NODE, sha3HexAddress(addr))`, ERC-165 advertised; 7-method reference surface) + `DefaultReverseRegistrar` (4-way inheritance with `StandaloneReverseRegistrar` + `SignatureUtils` library) — both seated under `addr.reverse` via canonical 2-step root handoff (D-09 Pitfall 3, deployer-signed) — *Validated in Phase 6: Public Registration (14 + 12 unit tests + 15 IntegrationRegistration cross-contract tests green; D-12 dual-path closure on in-process path; REG-06, REG-07, REG-13 closed)*
- [x] Public registration — `RiseRegistrarController`: 487 LOC port of reference `ETHRegistrarController` (commit-reveal with MIN_COMMITMENT_AGE = 60s / MAX = 86400s, native-token payment via `IPriceOracle`, refund-last reentrancy guard per Pitfall 2, resolver init via `multicallWithNodeCheck` only per Pitfall 4, reverse-record bitmask per Pitfall 7, **24 reserved-name labels seeded pre-handoff**, **launch allowlist with merkle proof gate + one-shot `endLaunch()`**); REG-13 closed via deploy script `02_setup_registration.ts` registering the controller as `controller=true` on `RegistrarSecurityController`, `ReverseRegistrar`, and `DefaultReverseRegistrar` (all owner-signed per Pitfall 2) — *Validated in Phase 6: Public Registration (36 unit tests + 15 integration tests + 702 prior-phase regression green; in-process D-12 path GREEN; REG-01..13 closed at unit+integration scope; live testnet round-trip deferred under DEFERRED-06-05-01 — Node 25 / Hardhat 3 keystore plugin incompatibility, recommended fix is Node 22 LTS downgrade; code review 0 critical / 2 warning / 9 info — both warnings inherited from upstream ENS reference `.transfer(2300 gas)` posture)*

- [x] Subdomain marketplace — a new `SubdomainRegistrar` (`Ownable, ReentrancyGuard`, OZ v4.9.3) letting a `.rise` 2LD owner sell subdomains: owner-set native-RISE price (zero allowed), instant push revenue split with an owner-settable capped (≤10% / 1000 bps) protocol fee and **no funds pooled**, optional single-token (ERC-20/721) `balanceOf` gate, and **lazy epoch-based invalidation** (owner-snapshot + `nameExpires` tuple derived from the frozen `RiseRegistrar`, no NameWrapper fuses) so subdomains die when the parent expires+re-registers. Operator-approval write path via `RNSRegistry.setSubnodeRecord` — never takes custody. Purely additive (zero Phase 1–6 edits) — *Validated in Phase 7: Subdomain Marketplace (31/31 subdomain tests [28 unit + 3 `loadAndExecuteDeployments` integration] + 735/735 full-suite regression green; SUB-01..07 closed at unit+integration scope; code review 1 critical / 3 warning / 5 info — CR-01 `parentLabelHash`↔`parentNode` forward-namehash binding, WR-01 2-arg `register` self-call refactor, WR-02 revoke `NotSold` guard all FIXED in commit `f0858a4`; WR-03 generation-counter deferred to v1.1 hardening, ties to accepted A1 same-address-re-registration edge)*

- [x] Enumeration & stats — `RiseRegistrar` inherits OZ v4.9.3 `ERC721Enumerable` + on-chain `tokensOfOwner(address)` (raw ERC-721 ownership, D-02); four global counters at their natural source contracts (`registrations`/`renewals` on `RiseRegistrar`, `totalSubdomains` on `SubdomainRegistrar`, `cumulativeVolume` — priced amount, not `msg.value` — on `RiseRegistrarController`); new additive read-only `RiseStats` aggregator surfacing all four in one call — no subgraph needed — *Validated in Phase 8: Protocol Extensions (ENUM-01..02; touched exactly the frozen `RiseRegistrar` per D-01; burn+remint-safe enumeration, `supportsInterface` reconciled)*
- [x] Interoperable identity — standalone additive `RiseInteropResolver` view: `node → RNSRegistry.resolver(node) → AddrResolver.addr(node) → ERC-7930 encode`; chain reference constructor-injected (D-10, never hardcoded), reverts `NoPrimaryAddress` on unset (D-11); the `.rise → account → ERC-8004` agent-identity spine — *Validated in Phase 8: Protocol Extensions (INTEROP-01; zero frozen-contract edits; golden-vector byte test pinned — mainnet + RiseChain testnet)*
- [x] Multi-year registration — register/renew 1–10 years in one tx with a hard 10-year cap; new `RiseDurationPriceOracle` (`IPriceOracle`) applying owner-tunable stepped discount tiers up to an immutable `MAX_DISCOUNT_BPS = 2000` cap; renew inherits register's discount via the shared `prices.price()` seam; 28-day base path unchanged — *Validated in Phase 8: Protocol Extensions (MYR-01..02; RF-1 forced the coordinated `RiseRegistrarController` redeploy since `prices` is immutable; one frozen-controller touch per D-01)*

### Active — Milestone v1.1 "Beyond the Fork"

<!-- Current scope. Building toward these. Reference-derived from mega-names + wei-names. -->

All v1.1 "Beyond the Fork" active scope is shipped and validated (see Validated above): subdomain
marketplace (Phase 7) + enumeration/stats, ERC-7930 interop, and multi-year registration (Phase 8).
Milestone v1.1 is feature-complete at the contract level — pending milestone audit/archive.

Deferred to a later milestone: Convenience layer (`UniversalResolver`, `BatchGatewayProvider`,
`StaticBulkRenewal`, `ExponentialPremiumPriceOracle` — CONV-01..04).

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
| `RiseRegistrarController` gains a reserved-name list **and** a launch allowlist | RNS aspires to be the de-facto canonical service — protect brand/system names from a launch land-grab and stage a controlled launch window | — Validated in Phase 6 (24 reserved labels + merkle allowlist + one-shot `endLaunch()` all REG-08..12 green at unit + integration scope) |
| `RisePriceOracle` — flat, owner-settable, native-token-denominated pricing; premium auction deferred | RiseChain has no Chainlink feed; flat pricing satisfies `IPriceOracle`; the exponential post-expiry premium is Phase 6 work | — Validated in Phase 5 |
| Keep `RootSecurityController` + `RegistrarSecurityController` | Small contracts; emergency controls (TLD removal, controller gating) that pair naturally with the controlled-launch policy | — Pending |
| Phases 1–5 verify on local Hardhat; Phase 6 (MVP gate) deploys to RiseChain testnet | Boundary revised 2026-05-26 (was: "Phase 5 deploys to testnet"). Phase 5 closes on in-process `loadAndExecuteDeployments` evidence; one real testnet deploy proves end-to-end at the MVP gate (Phase 6) where the controller, payment, and reverse registrar all converge | — In-process path validated; live testnet round-trip DEFERRED under DEFERRED-06-05-01 (Node 25 + Hardhat 3 keystore plugin HHE7 block; resolve via Node 22 LTS downgrade) |
| D-12 dual-path closure for MVP gate: in-process `IntegrationRegistration.test.ts` (15/15 it() blocks) AND out-of-process 5-point operator verifier (`scripts/verify-registration-testnet.ts`) | Belt-and-suspenders: in-process tests catch contract regressions cheaply; out-of-process verifier proves the production deploy works against real network economics. Accepting one without the other leaves a known-unknown gap | — In-process path validated in Phase 6; out-of-process path deferred under DEFERRED-06-05-01 |
| Native-token pricing instead of Chainlink USD conversion | No Chainlink ETH/USD feed exists at the hardcoded mainnet address on RiseChain | — Pending |
| `SubdomainRegistrar` uses lazy epoch-tuple invalidation, not NameWrapper fuses | RNS subnodes resolve through `RNSRegistry` directly (no epoch field) and `RiseRegistrar` is frozen; deriving `isActive` from an owner-snapshot + `nameExpires(parentLabelHash) >= snapshot` tuple — with `parentLabelHash` bound to `parentNode` via the `.rise` `riseNode` (sourced from `RiseRegistrar.baseNode()`) forward-namehash — reproduces wei-names epoch semantics with zero registrar changes. Pure push split, OZ v4 storage `ReentrancyGuard` (not `tstore`), no custody | — Validated in Phase 7 (SUB-05 epoch + SUB-07 custody integration tests green; CR-01 binding hardened) |

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
*Last updated: 2026-05-28 — Phase 8 (Protocol Extensions · v1.1) COMPLETE: 4/4 plans shipped, ENUM-01/02 + INTEROP-01 + MYR-01/02 validated at unit+integration scope. Shipped: `RiseRegistrar` ERC721Enumerable + `tokensOfOwner` + `registrations`/`renewals` counters; `SubdomainRegistrar.totalSubdomains`; coordinated `RiseRegistrarController` change (`cumulativeVolume` priced-amount counter + 1–10yr cap + repoint to the new oracle, RF-1-forced redeploy); new `RiseDurationPriceOracle` (tiered discount ≤2000bps cap); standalone `RiseInteropResolver` (ERC-7930, golden-vector pinned, constructor-injected chainId); new `RiseStats` aggregator. D-01 honored — exactly two frozen contracts touched (`RiseRegistrar`, `RiseRegistrarController`). 779/779 in-process tests green (the 1 failing suite is the live-node `TestLocalDeploy` env-prerequisite, not a regression); code review 0 critical / 3 warning / 5 info (no blockers); verifier verdict `passed` (5/5 must-haves). Milestone v1.1 feature-complete — next: milestone audit/archive. Prior: 2026-05-28 — Phase 7 (Subdomain Marketplace) COMPLETE: `SubdomainRegistrar` shipped (3/3 plans), SUB-01..07 validated at unit+integration scope (31/31 subdomain tests + 735/735 full-suite regression green via `loadAndExecuteDeployments`); code review found+fixed CR-01 (parentLabelHash↔parentNode binding), WR-01 (register self-call), WR-02 (revoke guard) in commit `f0858a4`, WR-03 deferred to v1.1 hardening; verifier verdict `passed`. Next: Phase 8 (Protocol Extensions — enumeration/stats + ERC-7930 interop + multi-year registration). Prior: 2026-05-28 — opened milestone v1.1 "Beyond the Fork": subdomain marketplace + ERC-721 enumeration/stats + ERC-7930 interop address + multi-year registration, reference-derived from the mega-names/wei-names analysis; NameWrapper superseded and retired to out-of-scope. Prior: 2026-05-26 after Phase 6 (Public Registration — MVP COMPLETE) completion — 5/5 plans shipped, REG-01..13 verified at unit + integration scope (62 Phase-6 unit tests across reverse-registrar + controller suites + 15 IntegrationRegistration cross-contract tests + 702/702 prior-phase regression suite green via `loadAndExecuteDeployments` rocketh-in-test fixture; D-12 in-process closure GREEN; live testnet 5-point verifier DEFERRED under DEFERRED-06-05-01 due to Node 25 + Hardhat 3 keystore plugin HHE7 incompatibility, recommended fix Node 22 LTS downgrade); commit→reveal→register→pay→renew→setName end-to-end **flow proven** in-process — the project's Core Value is met at the contract level, awaiting empirical testnet attestation*

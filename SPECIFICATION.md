# RNS — RiseChain Name Service · Fork Specification

**Project:** RNS (`.rise` name service)
**Status:** Specification — pre-execution. Maps the execution flow for a phased fork of ENS.
**Date:** 2026-05-20
**Repo:** `~/ideation-labs/rns-domains` · **ENS reference:** `reference/ens-contracts` (`@ensdomains/ens-contracts` v1.7.0, cloned read-only)
**Parent track:** R2 Markets → RiseChain pivot. RNS is the naming primitive of R2's agentic-infrastructure layer (Linear `COO-16`, `COO-38`, `COO-40`). Serves the R2 spec's `.rise name → account → ERC-8004 identity` spine.

---

## 1. What RNS Is — and Why

RNS is an ENS-style name service for **`.rise` names on RiseChain**. It lets any address register a human-readable `.rise` name, point it at records (addresses, text, contenthash), and set a primary (reverse) name.

**Why it exists:** R2 agents need persistent, human-readable handles bound to their durable account — the identity layer no chain primitive provides yet (RiseChain has no name service; greenfield). `.rise` names are the agent roster for R2's competitive/marketplace surfaces, and the resolution layer the `ERC-8004` identity registry and EAS reputation hang off.

**Strategy note:** being first means RNS can become the *de-facto canonical* name service of RiseChain — the address wallets/explorers/SDKs point at. That is an adoption outcome, powered by the team's RiseChain relationship; the build itself just needs to ship clean, on time, and correct.

---

## 2. What We Are Forking

We fork the **classic ENS contracts architecture** — registry / registrar / controller / resolver / reverse-registrar — from `ensdomains/ens-contracts` v1.7.0.

We do **not** fork ENSv2 / Namechain (ENS's own L2 design) — it is more entangled with cross-chain machinery than a single-chain `.rise` service needs.

**The fork method is deliberate and phased.** We do not copy the repo wholesale. We study the reference, then re-create the contracts phase by phase, ordered by the dependency graph, fixing RiseChain-specific changes as each contract comes in. Each phase compiles, deploys, and is verified before the next begins. This is the GSD project structure (§7).

---

## 3. Scope

**In scope** — the on-chain name service:
- Register a `.rise` name (commit-reveal, priced, renewable)
- Resolve records (`addr`, `text`, `contenthash`, …)
- Reverse resolution (primary names) — RiseChain-local

**Out of scope (deferred or dropped):**
- A registration **frontend app** — separate track, post-contracts
- A **JS/TS SDK** — separate track, post-contracts
- **DNSSEC oracle + DNS-name import** — dropped entirely; no analog for a greenfield `.rise` namespace
- **NameWrapper** (ERC-1155 wrapping + fuses) — deferred to an optional late phase; the v3 controller does not need it
- **L1-readable reverse resolution** (cross-chain reverse) — deferred; RiseChain is the home chain for `.rise`
- Migration scaffolding (`ENSRegistryWithFallback`, `MigrationHelper`, legacy controllers, `FIFSRegistrar`) — dropped

---

## 4. The Architecture — Moving Parts

| Contract | What it does |
|---|---|
| **RNSRegistry** (← `ENSRegistry`) | The core. A single map `node → {owner, resolver, ttl}`. Holds no business logic — pure ownership/authorization. Everything else reads or writes it. |
| **Root** | Owns the registry's root node (`0x0`); the only contract that can assign a TLD. Gates `.rise` creation; can lock a TLD permanently. |
| **RootSecurityController** | A Root controller that can only *remove* TLDs — emergency revocation. |
| **RiseRegistrar** (← `BaseRegistrarImplementation`) | The `.rise` registrar. An ERC-721 where tokenId = `labelhash` of a 2LD; owns the `.rise` node; tracks per-name expiry + grace period. `register`/`renew` restricted to controllers. |
| **RegistrarSecurityController** | Owns the registrar and gates which controllers may register/renew. |
| **RisePriceOracle** (← `StablePriceOracle`, rewritten) | Per-length name pricing. **Rewritten for RiseChain** — see §6. |
| **RiseRegistrarController** (← `ETHRegistrarController` v3) | The public registration entry point: commit-reveal, pricing, payment, renewal, optional resolver-record multicall, optional reverse-record setup. |
| **PublicResolver** | The default resolver. Profile mixins: `addr` (multi-coin), `text`, `contenthash`, `ABI`, `interface`, `name`, `pubkey`, `dns`, `data` + `Multicallable`. |
| **OwnedResolver** | Minimal single-owner resolver assigned to the `.rise` node itself (interface-ID registry). |
| **ReverseRegistrar** + **DefaultReverseRegistrar** | Manage the `addr.reverse` namespace; let an address set its primary `.rise` name. Both are required by the v3 controller constructor. |
| **UniversalResolver** *(Phase 6)* | One-call resolution + CCIP-Read handling. Read-side convenience for SDKs/frontends. |
| **NameWrapper** *(Phase 7, optional)* | Wraps names as ERC-1155 with fuses (trustless restricted subdomains). |

---

## 5. The Dependency Chain

ENS's `deploy/` scripts declare explicit `dependencies: [...]` arrays — the authoritative deploy graph. The hard ordering:

```
RNSRegistry
   └─> Root ──> RootSecurityController
         └─> RiseRegistrar ──> RegistrarSecurityController
               ├─> RisePriceOracle        (independent — can be built in parallel)
               ├─> OwnedResolver
               ├─> ReverseRegistrar + DefaultReverseRegistrar
               └─> RiseRegistrarController ──> PublicResolver
```

Nothing can be deployed before its dependency. This chain *is* the phase order in §7.

---

## 6. RiseChain Fork Changes

Concrete edits required versus the ENS reference:

1. **`.eth` → `.rise` TLD.** `RiseRegistrar` takes `baseNode` as a constructor arg — set it to `namehash('rise')` in the deploy script (contract code is generic). **But hardcoded constants must be edited in code:**
   - `RiseRegistrarController.sol` — the `ETH_NODE` constant → recompute as `namehash('rise')`; the `string.concat(label, ".eth")` for reverse records → `".rise"`.
   - `NameWrapper.sol` `ETH_NODE` / `ETH_LABELHASH` — only if NameWrapper is adopted (Phase 7).
   - Deploy scripts: `namehash('eth')`, `labelhash('eth')`, `namehash('resolver.eth')` → `.rise` equivalents.
2. **Price oracle — drop the Chainlink dependency.** `StablePriceOracle` calls a hardcoded mainnet Chainlink ETH/USD feed (`0x5f4eC3Df…`). RiseChain has no such feed at that address. **`RisePriceOracle`** is rewritten: owner-settable per-length prices denominated directly in the native token (no USD conversion) for MVP. The `IPriceOracle` interface is preserved so the controller is unchanged. Real price feeds (Pyth/RedStone/native) are a post-MVP upgrade.
3. **Reverse namespace.** Keep the simple `addr.reverse` model — RiseChain is the home chain for `.rise`. The ENSIP-19 L2-coinType reverse machinery (`L2ReverseRegistrar`, `ChainReverseResolver`) is **dropped** for MVP. (Revisit only if `.rise` primary names must be readable from Ethereum L1.)
4. **Hardcoded addresses to audit/replace:** the Chainlink feed; the mainnet owner address in `rocketh.ts`; the Safe-multisig / CREATE3 config in the L2 deploy branch (dropped with that branch); `Multicall3` (`0xcA11…`) — confirm it is deployed on RiseChain if any batched setup uses it.
5. **EVM version.** ENS sets `evmVersion: 'paris'`. Confirm RiseChain's EVM ≥ Paris (it is — RiseChain is Cancun-class). No block-number assumptions: ENS uses `block.timestamp` throughout, which is reliable on RiseChain.

---

## 7. The Phased Fork Plan

Eight phases. Each phase compiles, deploys to a local/RiseChain testnet, and passes its verification gate before the next starts. Phases 0–5 are the **MVP**; 6–7 are post-launch.

### Phase 0 — Repo scaffold & shared libraries
- Stand up `rns-domains` as a Hardhat 3 + Bun project (see §8). Bring over `contracts/utils/` (`NameCoder`, `BytesUtils`, `HexUtils`, `StringUtils`, `ENSIP19`), the core interfaces, and the Vitest + viem test harness skeleton.
- **Done when:** repo compiles clean; the test harness runs; shared utils have passing unit tests.

### Phase 1 — Naming layer foundation
- `RNSRegistry`, `Root`, `RootSecurityController`. Wire root-node ownership to `Root`.
- **Done when:** deployed to testnet; `Root` owns the registry root; an arbitrary subnode can be created and owned.

### Phase 2 — The `.rise` registrar
- `RiseRegistrar` (`baseNode = namehash('rise')`), `RegistrarSecurityController`. `Root.setSubnodeOwner(labelhash('rise'), registrar)`.
- **Done when:** the `.rise` TLD is assigned; an authorized controller can mint a `.rise` 2LD as an ERC-721 with a tracked expiry.

### Phase 3 — Resolution
- The resolver `profiles/`, `PublicResolver`, `OwnedResolver` (for the `.rise` node).
- **Done when:** a name can store and return an `addr` record and a `text` record.

### Phase 4 — Pricing
- `RisePriceOracle` — custom, owner-settable, native-token-denominated; satisfies `IPriceOracle` (§6.2).
- **Done when:** `rentPrice(name, duration)` returns correct per-length prices; integrates with the controller interface.

### Phase 5 — Public registration  ·  **MVP COMPLETE**
- `ReverseRegistrar`, `DefaultReverseRegistrar`, then `RiseRegistrarController` (renamed, `ETH_NODE` recomputed, `.eth`→`.rise` strings fixed). Register the controller on the registrar + both reverse registrars.
- **Done when:** a user can commit → reveal → register a `.rise` name end to end, pay, renew, and set a primary (reverse) name. **This is the shippable name service.**

### Phase 6 — Convenience  *(post-launch, optional)*
- `BatchGatewayProvider` + `UniversalResolver`; `StaticBulkRenewal`; optionally `ExponentialPremiumPriceOracle` (post-expiry Dutch-auction premium).
- **Done when:** one-call resolution works; bulk renewal works.

### Phase 7 — Advanced  *(optional, only if subdomain products are wanted)*
- `NameWrapper` + `ERC1155Fuse` + `StaticMetadataService`. Note: may require a NameWrapper-aware controller variant — the v3 controller does not integrate it.
- **Done when:** a name can be wrapped as an ERC-1155 with fuses burned.

---

## 8. Build & Tooling

**Decision: keep ENS's toolchain — Hardhat 3 + Bun + Vitest/viem, Solidity 0.8.26 (`paris`).**

Rationale: the ENS deploy scripts *are* the dependency graph and the tests mirror the contracts one-to-one. Switching to Foundry (which R2's other contracts use) would mean rewriting every deploy script and test — pure friction that adds error surface, exactly what the phased approach exists to avoid. Forking is lower-risk when the harness is forked too. A Foundry migration, if ever wanted, is a post-MVP concern.

`NameWrapper` is pinned to Solidity 0.8.17 in the reference — irrelevant unless Phase 7 is taken.

---

## 9. Open Decisions (resolve during GSD discuss/plan)

- **`RisePriceOracle` final design** — flat per-length pricing for MVP is assumed; confirm the price schedule and whether a premium auction is wanted at launch (Phase 6) or later.
- **Keep `RootSecurityController` / `RegistrarSecurityController`?** — small contracts, useful emergency controls; assumed kept. Confirm.
- **`.rise` registration policy** — min length, reserved names, who may register during a launch window. Not a contract-architecture question, but the controller enforces it.
- **NameWrapper** — confirm it stays deferred (Phase 7) and is not needed for the R2 agent use case at launch.
- **L1-readable reverse resolution** — confirmed out of MVP scope; revisit only if cross-chain reverse is needed.

---

## 10. How This Feeds GSD

Each phase above maps to one GSD phase; each phase's **"Done when"** is its GSD verification gate (goal-backward). `gsd-new-project` consumes this spec as the project's deep-context input; the §7 phase list seeds the roadmap; §9 are the discuss-phase questions.

Reference always kept open while forking: `reference/ens-contracts/deploy/` (the dependency arrays), `contracts/ethregistrar/ETHRegistrarController.sol` (the `ETH_NODE` constant + `.eth` strings), `contracts/ethregistrar/StablePriceOracle.sol` (the Chainlink seam).

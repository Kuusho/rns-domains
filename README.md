# RNS — RiseChain Name Service

RNS is an on-chain name service for **`.rise` names on RiseChain**. It is a deliberate, phased
fork of the classic ENS contract architecture (`ensdomains/ens-contracts` v1.7.0), re-created
contract-by-contract along the ENS dependency graph with RiseChain-specific changes applied as
each contract comes in.

RNS is the naming and identity primitive for R2 Markets' agentic-infrastructure layer: it serves
the **`.rise name → account → ERC-8004 identity`** spine that on-chain agents need for persistent,
human-readable handles.

---

## What is a `.rise` name?

A `.rise` name (e.g. `alice.rise`) is an **ERC-721 token** minted by the `.rise` registrar. Owning
the token means you own the name. A name lets you:

- **Point at records** — a primary address (multi-coin), text records (twitter, avatar URL, bio),
  a contenthash (IPFS/Arweave site), and more.
- **Be resolved in reverse** — set a name as your address's *primary* name so wallets and explorers
  display `alice.rise` instead of `0xFe8E…6Ad1`.
- **Sell subdomains** — list your name (e.g. `alice.rise`) and sell `bob.alice.rise` to others,
  with an automatic revenue split.
- **Carry a cross-chain identity** — resolve to an ERC-7930 interoperable-address encoding, the
  account spine that ERC-8004 agent identity hangs off.

Names are registered through a **commit → reveal → register** flow (anti-front-running), paid for
in RiseChain's native token, and held for a chosen duration (1–10 years) with renewal.

---

## Present functionality (shipped)

Everything below is implemented in Solidity, unit- and integration-tested in-process against a
simulated RiseChain, and deployable via the rocketh deploy scripts. (Live testnet round-trip is
deferred under `DEFERRED-06-05-01` — see [`SPECIFICATION.md`](./SPECIFICATION.md).)

### v1.0 — the MVP fork (Phases 1–6)

| Capability | What it does |
|---|---|
| **Registry & root** | `RNSRegistry` stores `(owner, resolver, ttl)` per node; `RNSRoot` owns the `0x0` root and is the only contract that can create the `.rise` TLD. |
| **`.rise` registrar** | `RiseRegistrar` mints names as ERC-721 tokens (id = label hash), tracks expiry + a 90-day grace period, and gates `register`/`renew` to approved controllers. |
| **Resolution** | `PublicResolver` (+ profile mixins: addr, text, contenthash, ABI, interface, name, pubkey) stores records; `RiseOwnedResolver` is the `.rise` node's resolver. |
| **Pricing** | `RisePriceOracle` returns native-token rent by name length — no Chainlink/USD dependency. |
| **Public registration** | `RiseRegistrarController` runs commit → reveal → register, takes payment, refunds overpayment, sets records and reverse names in one transaction, and enforces a reserved-name list + a controlled-launch allowlist. |
| **Reverse resolution** | `ReverseRegistrar` (`addr.reverse`) + `DefaultReverseRegistrar` let an address set its primary name. |

### v1.1 — Beyond the Fork (Phases 7–8)

| Capability | What it does |
|---|---|
| **Subdomain marketplace** | `SubdomainRegistrar` lets a `.rise` 2LD owner sell subdomains: owner-set native-RISE price, instant revenue split with a capped protocol fee (no funds pooled), optional ERC-20/721 token gate, and lazy **epoch-based invalidation** (a parent's subdomains die when the parent expires and is re-registered). Never takes custody of the parent name. |
| **On-chain enumeration** | `RiseRegistrar.tokensOfOwner(address)` returns every name an address owns — no subgraph required. |
| **Global stat counters** | Lifetime `registrations`, `renewals`, `totalSubdomains`, and `cumulativeVolume` counters, plus a `RiseStats` aggregator that returns all of them (and live supply) in one call for a `/stats` page. |
| **Interoperable identity** | `RiseInteropResolver` encodes a name's primary address as an **ERC-7930 interoperable address** — the `.rise → account → ERC-8004` spine. |
| **Multi-year registration** | Register or renew for **1–10 years** in one transaction, with an owner-tunable **tiered discount** (default 1yr 0% · 2–3yr 5% · 4–5yr 10% · 6–9yr 15% · 10yr 20%, capped at 20%) via `RiseDurationPriceOracle`. |

For the full per-contract, per-function breakdown and the frontend integration recipes, see
[`IMPLEMENTATION.md`](./IMPLEMENTATION.md).

---

## Generative identity (name-derived NFT visuals)

Every `.rise` name is an NFT, and every name gets a **deterministic, name-derived visual identity** —
a generative avatar and a 1200×630 social link-preview (OG) card. One algorithm produces both:

```
b     = keccak256(namehash(name)).slice(0, 6)   // 6 hash bytes
hue1  = b[0] · 360 / 255                          // base hue
hue2  = (hue1 + 30 + b[1] % 90) % 360             // analogous second hue
comp  = b[2] % 4                                  // gradient composition
glyph = b[3] % 6                                  // sun · aperture · orbit · arc · diamond · chain
rot   = b[4] · 360 / 255                          // glyph rotation
sat   = 55 + b[5] % 25                            // saturation
```

Because it is derived from the name's `namehash`, the avatar is **stable and reproducible anywhere** —
the same name always renders the same art, with no stored image and no central server.

> **Status:** the generator lives in [`frontend/generative/`](./frontend/generative/) as a pure-SVG
> reference implementation (run `bun run frontend/generative/generate.ts`). It is **off-chain today**
> — not yet wired into an on-chain `tokenURI` — and is structured to port to a production
> `@vercel/og` (satori) edge pipeline. The byte→visual-params core (`avatarParams`) is the portable,
> single-source-of-truth piece; see [`frontend/generative/README.md`](./frontend/generative/README.md).

---

## Architecture

```
RNSRegistry ── owns ──► RNSRoot ──► RNSRootSecurityController
     │
     ├─ .rise TLD ──► RiseRegistrar (ERC-721) ──► RegistrarSecurityController
     │                    │
     │                    ├─ RiseRegistrarController ──► RisePriceOracle / RiseDurationPriceOracle
     │                    │        └─ ReverseRegistrar + DefaultReverseRegistrar (addr.reverse)
     │                    └─ SubdomainRegistrar (v1.1, operator-approval — no custody)
     │
     ├─ resolver ──► PublicResolver (addr · text · contenthash · …) / RiseOwnedResolver
     │
     └─ read-only views ──► RiseStats (counters) · RiseInteropResolver (ERC-7930)
```

**Build order is the ENS dependency graph** — nothing is deployed before its dependency. See
[`SPECIFICATION.md`](./SPECIFICATION.md) §5.

---

## Quickstart

```bash
bun install                       # install deps (Bun)
bun run compile                   # hardhat compile (solc 0.8.26, evmVersion paris)
bun run test                      # compile + full Vitest/viem suite (in-process)

# Local deploy (against a running node)
npx hardhat node                  # in one terminal
bun run deploy:local              # full Phase 1→8 chain via rocketh
```

**Stack:** Hardhat 3 · Bun · Vitest + viem · Solidity 0.8.26 (`evmVersion: paris`) · OpenZeppelin
Contracts v4.9.3 · rocketh deploy harness. RiseChain testnet chainId is `11155931`.

---

## Reference codebases & credits

RNS stands on the shoulders of prior open-source work. With gratitude:

- **[`ensdomains/ens-contracts`](https://github.com/ensdomains/ens-contracts) v1.7.0** — the
  architecture RNS forks: registry, registrar, controller, resolver, and reverse-registrar. The
  generic utility libraries under `contracts/utils/` are copied verbatim with ENS's MIT headers
  intact; domain contracts are re-created, not copied. Original license: MIT © True Names Limited
  (see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE)).
- **`mega-names` (MegaETH)** and **`wei-names` (audited)** — the v1.1 reference codebases. The
  `SubdomainRegistrar` epoch-invalidation pattern (lazy, NameWrapper-free subdomain monetization)
  is derived from the audited `wei-names` design.
- **[OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) v4.9.3** —
  `ERC721`/`ERC721Enumerable`, `Ownable`, `ReentrancyGuard`.
- **[ERC-7930](https://eips.ethereum.org/EIPS/eip-7930)** (Interoperable Addresses) and the
  **eip155 CAIP-350** profile — the interop-address wire format the `RiseInteropResolver` implements.
- **[ERC-8004](https://eips.ethereum.org/EIPS/eip-8004)** — the downstream agent-identity registry
  RNS resolution feeds (context; not implemented here).

---

## Documentation

| Document | Contents |
|---|---|
| [`SPECIFICATION.md`](./SPECIFICATION.md) | Scope, contract spec, phase plan, dependency graph |
| [`IMPLEMENTATION.md`](./IMPLEMENTATION.md) | Per-feature contract/function breakdown + viem/wagmi integration recipes + frontend TODO |
| [`frontend/SPEC.md`](./frontend/SPEC.md) | Full frontend specification (brand, screens, features, build order) |
| [`frontend/generative/README.md`](./frontend/generative/README.md) | The generative avatar / OG-card system |

---

*RNS is a fork delivered for correctness — the contracts are the product. Canonical adoption as
RiseChain's name service is a separate, downstream outcome.*

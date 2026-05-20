<!-- GSD:project-start source:PROJECT.md -->
## Project

**RNS — RiseChain Name Service**

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

**Core Value:** A user can **commit → reveal → register a `.rise` name end-to-end, pay, renew, resolve its
records, and set a primary (reverse) name** — delivered as a clean, correct fork of the ENS
contract architecture on RiseChain. If everything else is deferred, this end-to-end name
service must work.

### Constraints

- **Tech stack**: Hardhat 3 + Bun + Vitest/viem, Solidity 0.8.26 (`evmVersion: paris`) —
  keep ENS's toolchain unchanged. The ENS deploy scripts *are* the dependency graph and the
  tests mirror the contracts one-to-one; switching to Foundry would mean rewriting every
  script and test (pure friction, added error surface). `NameWrapper` is pinned to Solidity
  0.8.17 in the reference — relevant only if Phase 7 is built.
- **Build order**: contracts must be created in the spec §5 dependency-chain order. Nothing
  can be deployed before its dependency.
- **Phase gates**: each phase compiles, deploys, and passes its "Done when" verification gate
  before the next starts. Phases 0–4 verify on a **local Hardhat network**; Phase 5 (MVP
  complete) deploys to the **RiseChain testnet** for end-to-end verification.
- **RiseChain fork edits**: `.eth → .rise` (TLD strings, `ETH_NODE` constant recompute,
  deploy-script namehashes); drop the Chainlink dependency for native-token pricing; keep the
  simple `addr.reverse` reverse model; audit/replace hardcoded addresses (Chainlink feed,
  mainnet owner in `rocketh.ts`, Safe/CREATE3 L2 branch, `Multicall3`).
- **Correctness**: "ship clean, on time, and correct" — the contracts are the product;
  canonical adoption is a separate, downstream outcome.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:STACK.md -->
## Technology Stack

Technology stack not yet documented. Will populate after codebase mapping or first phase.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->

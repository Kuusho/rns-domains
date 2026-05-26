# RNS Interface-Porting Policy

> **SCAF-03 deliverable.** This document is a *policy*, not an interface container. It records
> where Solidity interface files live and the rule downstream phases follow when porting them.
> No `.sol` interface file belongs in this directory.

## Fork context

RNS is a deliberate, phased fork of `ensdomains/ens-contracts` **v1.7.0** (read-only reference
at `reference/ens-contracts/`). The fork is re-created phase by phase along the spec §5
dependency chain — never copied wholesale.

ENS does **not** keep a central `interfaces/` directory for its Solidity interface files.
Instead it **co-locates each interface with the contract subdirectory that owns it** — e.g.
`contracts/registry/ENS.sol`, `contracts/resolvers/profiles/IAddrResolver.sol`,
`contracts/ethregistrar/IPriceOracle.sol`. RNS **keeps this convention** (decision D-04):
there is **no central interfaces directory for interface FILES**. This `interfaces/` directory
holds only this policy README.

## The rule

**Each ENS interface is ported in the phase that first needs it, into that phase's own
contract subdirectory.** Subdirectories under `contracts/` are created as their phase arrives
(decision D-11 — "subdirectories created as their phase arrives"), and the interface is
co-located there with the contract that consumes/implements it.

Examples:

- `registry/ENS.sol` — the foundational registry interface — is ported in **Phase 2**, into
  `contracts/registry/`.
- Resolver profile interfaces (`IAddrResolver`, `ITextResolver`, `IContentHashResolver`, …)
  are ported in **Phase 4**, into `contracts/resolvers/profiles/`.
- `IPriceOracle` is ported in **Phase 5**, into the price-oracle subdirectory.

## Phase 1 finding

Import-tracing in [`../../.planning/phases/01-repo-scaffold-shared-libraries/01-RESEARCH.md`](../../.planning/phases/01-repo-scaffold-shared-libraries/01-RESEARCH.md)
proved that the MVP-transitive utility set ported in Phase 1 —

`NameCoder`, `BytesUtils`, `HexUtils`, `StringUtils`, `ENSIP19`, `LibMem`, `ERC20Recoverable`

— imports **no standalone Solidity interface file**. `ERC20Recoverable` imports OpenZeppelin's
`Ownable` and `IERC20` (audited library code resolved via `remappings.txt`), but no ENS
interface. The most import-heavy ported util, `ENSIP19`, imports only sibling libraries
(`HexUtils`, `NameCoder`).

**Therefore Phase 1 ports zero interface files.** SCAF-03 ("core ENS interfaces ported and
available to downstream contracts") is satisfied in Phase 1 by establishing *this policy* —
the concrete, checkable artifact that records the finding and the rule Phases 2–8 follow.

## Out of scope

`IERC7996.sol` is the **only** interface file under ENS `contracts/utils/`. It is **explicitly
out of scope** for RNS — reachable only from dropped/deferred scope (cross-chain reverse
resolution, `UniversalResolver`). It is **not** ported.

## Forward index — which interface arrives in which phase

| Phase | Interfaces first needed | Lands in |
|-------|-------------------------|----------|
| 1 — Repo Scaffold & Shared Libraries | *(none — util set needs zero interface files)* | — |
| 2 — Naming Layer Foundation | `ENS.sol` (registry interface) | `contracts/registry/` |
| 3 — The .rise Registrar | ERC-721 registrar interface(s) for `RiseRegistrar` | `contracts/ethregistrar/` (or RNS-renamed registrar subdir) |
| 4 — Resolution | resolver profile interfaces (`IAddrResolver`, `ITextResolver`, `IContentHashResolver`, ABI/interface/name/pubkey/dns/data mixins) | `contracts/resolvers/profiles/` |
| 5 — Pricing | `IPriceOracle` | `contracts/registrar-controller/` |
| 6 — Public Registration | reverse-registrar / controller interfaces | reverse-registrar + controller subdirs |
| 7 — Convenience *(optional)* | `UniversalResolver` / batch-gateway interfaces | convenience subdir |
| 8 — Name Wrapping *(optional)* | `NameWrapper` / ERC-1155 fuse interfaces | name-wrapper subdir |

> Downstream planners: use this table as a checklist. When a phase begins, port the interfaces
> listed for it, co-located with the owning contract subdirectory per the rule above. Update
> this table if dependency tracing for that phase surfaces an additional interface.

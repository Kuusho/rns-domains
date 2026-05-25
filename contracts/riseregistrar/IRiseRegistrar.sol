// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @title IRiseRegistrar — the frozen external interface of the .rise registrar.
/// @notice Every external consumer of the `.rise` registrar (the Phase 6
///         `RiseRegistrarController`, the `RegistrarSecurityController`
///         break-glass, off-chain SDKs and explorers) reads and writes the
///         registrar through this interface. Implementations of this interface
///         are ERC-721 token contracts where each registered `.rise` 2LD is a
///         token with `id == labelhash(label)`.
/// @dev Clean-room re-implementation of ENS's `IBaseRegistrar` (Phase 2 D-06,
///      Phase 3 D-08 / D-10). The function signatures and event topic layouts
///      below are byte-for-byte ENS-compatible and frozen by Phase 2 D-07: the
///      spec §5 dependency chain types its registrar dependency through this
///      surface, so it must never drift.
///
///      Layout decisions:
///      - **Separate file** (D-08): co-located with the implementation in
///        `contracts/riseregistrar/`, mirroring the reference's
///        `IBaseRegistrar.sol`. Phase 2's inline-interface pattern (Phase 2 D-10
///        `RNS` interface inlined into `RNS.sol`) was for a single-implementer
///        interface; this is a multi-consumer interface and gets its own file.
///      - **Renamed** (D-10): `IRiseRegistrar` not `IBaseRegistrar`. "Base" in
///        the reference signaled "abstract base for the `.eth` registrar"; for a
///        single-TLD service the interface IS the `.rise` registrar's interface.
///      - **Migration-event dropped** (D-09): the reference's
///        `BaseRegistrarImplementation` never emits the legacy v1 migration
///        event — it is a fossil from the pre-migration ENS registrar.
///        Migration is out of scope for RNS (PROJECT.md: "Migration
///        scaffolding — dropped; nothing to migrate from on a greenfield
///        chain"). Same precedent as Phase 2 D-13's drop of
///        `ENSRegistryWithFallback`.
///      - **`reclaim` + `setResolver` kept** (D-11): both are live, observable
///        behavior. `reclaim` lets the ERC-721 owner re-assert registry
///        ownership after a transfer; `setResolver` is the path Phase 4 will
///        use to assign `OwnedResolver` to the `.rise` node itself (RES-07).
interface IRiseRegistrar is IERC721 {
    /// @notice Emitted when an address is granted controller permission to
    ///         register and renew names through this registrar.
    /// @param controller The address granted controller permission.
    event ControllerAdded(address indexed controller);

    /// @notice Emitted when an address has its controller permission revoked.
    /// @param controller The address whose controller permission was revoked.
    event ControllerRemoved(address indexed controller);

    /// @notice Emitted when a name is registered. Token id is the labelhash of
    ///         the registered label.
    /// @param id The labelhash of the registered label, also the ERC-721
    ///        token id.
    /// @param owner The address of the new registrant.
    /// @param expires The new expiry timestamp (`block.timestamp + duration`).
    event NameRegistered(
        uint256 indexed id,
        address indexed owner,
        uint256 expires
    );

    /// @notice Emitted when a name is renewed.
    /// @param id The labelhash of the renewed label.
    /// @param expires The new expiry timestamp (`old expiry + duration`).
    event NameRenewed(uint256 indexed id, uint256 expires);

    /// @notice Authorises a controller to register and renew names through this
    ///         registrar. Implementations restrict this to the registrar's
    ///         owner (the `RegistrarSecurityController` in deployed RNS).
    /// @param controller The address to grant controller permission to.
    function addController(address controller) external;

    /// @notice Revokes a controller's permission to register and renew names.
    ///         Implementations restrict this to the registrar's owner.
    /// @param controller The address to revoke.
    function removeController(address controller) external;

    /// @notice Sets the resolver for the TLD node this registrar owns
    ///         (`baseNode`, e.g. `namehash('rise')`). Implementations restrict
    ///         this to the registrar's owner.
    /// @param resolver The address of the resolver to assign to `baseNode`.
    function setResolver(address resolver) external;

    /// @notice Returns the expiry timestamp of the name with the given id.
    /// @param id The labelhash of the label, also the ERC-721 token id.
    /// @return The expiry timestamp, or `0` if the name was never registered.
    function nameExpires(uint256 id) external view returns (uint256);

    /// @notice Returns whether the name with the given id is available for
    ///         registration. Implementations return `true` only once the name's
    ///         expiry plus grace period has elapsed (or the name was never
    ///         registered).
    /// @param id The labelhash of the label, also the ERC-721 token id.
    /// @return True if the name is registerable.
    function available(uint256 id) external view returns (bool);

    /// @notice Registers a name and mints the corresponding ERC-721 token.
    ///         Implementations restrict this to authorised controllers AND
    ///         require the registrar still owns its TLD node (`live` modifier).
    /// @param id The labelhash of the label to register.
    /// @param owner The address that will own the registration.
    /// @param duration The registration duration in seconds.
    /// @return The new expiry timestamp.
    function register(
        uint256 id,
        address owner,
        uint256 duration
    ) external returns (uint256);

    /// @notice Extends the expiry of an already-registered name.
    ///         Implementations restrict this to authorised controllers AND
    ///         require the name is still in its registered or grace window.
    /// @param id The labelhash of the label to renew.
    /// @param duration The number of additional seconds to extend by.
    /// @return The new expiry timestamp.
    function renew(uint256 id, uint256 duration) external returns (uint256);

    /// @notice Re-asserts registry ownership of the name to `owner` on behalf
    ///         of the current ERC-721 owner (or an approved/operator). The path
    ///         the ERC-721 owner uses to restore registry-side ownership after
    ///         a token transfer (which does not update the registry).
    /// @param id The labelhash of the label to reclaim.
    /// @param owner The address to assign registry ownership of the name to.
    function reclaim(uint256 id, address owner) external;
}

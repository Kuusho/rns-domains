// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IVersionableResolver
/// @notice Event + view interface for resolvers that expose a per-node version
///         counter. Incrementing the counter atomically invalidates every prior
///         record across every profile mixin for that node.
/// @dev Ported verbatim-in-intent from
///      reference/ens-contracts/contracts/resolvers/profiles/IVersionableResolver.sol.
///      Pragma raised from `>=0.8.4` to `^0.8.26` per Phase 4 D-11 to match the
///      Phase 2/3 precedent (RNSRegistry, RiseRegistrar).
interface IVersionableResolver {
    event VersionChanged(bytes32 indexed node, uint64 newVersion);

    function recordVersions(bytes32 node) external view returns (uint64);
}

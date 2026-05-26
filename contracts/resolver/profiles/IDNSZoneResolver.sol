// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IDNSZoneResolver
/// @notice Profile interface for the per-node DNS zonehash record.
/// @dev Ported verbatim-in-intent from
///      reference/ens-contracts/contracts/resolvers/profiles/IDNSZoneResolver.sol.
///      Pragma raised from `>=0.8.4` to `^0.8.26` per Phase 4 D-11.
interface IDNSZoneResolver {
    // DNSZonehashChanged is emitted whenever a given node's zone hash is updated.
    event DNSZonehashChanged(
        bytes32 indexed node,
        bytes lastzonehash,
        bytes zonehash
    );

    /// zonehash obtains the hash for the zone.
    /// @param node The ENS node to query.
    /// @return The associated contenthash.
    function zonehash(bytes32 node) external view returns (bytes memory);
}

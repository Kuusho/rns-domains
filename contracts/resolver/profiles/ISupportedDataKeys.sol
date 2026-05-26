// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title ISupportedDataKeys
/// @notice Companion interface for the ENSIP-24 data-key advertisement surface
///         (`supportedDataKeys(node) => string[]`). The concrete mixin that
///         implements this is intentionally NOT ported in Phase 4 (see
///         04-RESEARCH.md Open Question 2 and Plan 04-01 SUMMARY); only the
///         interface is co-located so future Phase-5+ data-key-aware contracts
///         can import it by name without an artifact-resolution edit.
/// @dev Ported verbatim-in-intent from
///      reference/ens-contracts/contracts/resolvers/profiles/ISupportedDataKeys.sol.
///      Interface selector: `0x29fb1892`.
interface ISupportedDataKeys {
    /// @notice For a specific `node`, get an array of supported data keys.
    /// @param node The node (namehash).
    /// @return The keys for which we have associated data.
    function supportedDataKeys(
        bytes32 node
    ) external view returns (string[] memory);
}

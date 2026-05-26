// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IContentHashResolver
/// @notice Profile interface for `contenthash(node) => bytes` (EIP-1577) records.
/// @dev Ported verbatim-in-intent from
///      reference/ens-contracts/contracts/resolvers/profiles/IContentHashResolver.sol.
///      Pragma raised from `>=0.8.4` to `^0.8.26` per Phase 4 D-11.
interface IContentHashResolver {
    event ContenthashChanged(bytes32 indexed node, bytes hash);

    /// Returns the contenthash associated with an ENS node.
    /// @param node The ENS node to query.
    /// @return The associated contenthash.
    function contenthash(bytes32 node) external view returns (bytes memory);
}

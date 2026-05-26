// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title INameResolver
/// @notice Profile interface for EIP-181 reverse-name records (`name(node) => string`).
/// @dev Ported verbatim-in-intent from
///      reference/ens-contracts/contracts/resolvers/profiles/INameResolver.sol.
///      Pragma raised from `>=0.8.4` to `^0.8.26` per Phase 4 D-11.
interface INameResolver {
    event NameChanged(bytes32 indexed node, string name);

    /// Returns the name associated with an ENS node, for reverse records.
    /// Defined in EIP181.
    /// @param node The ENS node to query.
    /// @return The associated name.
    function name(bytes32 node) external view returns (string memory);
}

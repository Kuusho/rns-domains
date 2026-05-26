// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IAddrResolver
/// @notice Interface for the legacy (ETH-only) `addr(node) => address` lookup.
/// @dev Ported verbatim-in-intent from
///      reference/ens-contracts/contracts/resolvers/profiles/IAddrResolver.sol.
///      Pragma raised from `>=0.8.4` to `^0.8.26` per Phase 4 D-11.
interface IAddrResolver {
    event AddrChanged(bytes32 indexed node, address a);

    /// Returns the address associated with an ENS node.
    /// @param node The ENS node to query.
    /// @return The associated address.
    function addr(bytes32 node) external view returns (address payable);
}

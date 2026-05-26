// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IHasAddressResolver
/// @notice Existence-check companion to IAddressResolver.
/// @dev Ported verbatim-in-intent from
///      reference/ens-contracts/contracts/resolvers/profiles/IHasAddressResolver.sol.
///      Pragma raised from `>=0.8.4` to `^0.8.26` per Phase 4 D-11.
interface IHasAddressResolver {
    /// @notice Determine if an addresss is stored for the coin type of the associated ENS node.
    /// @param node The node to query.
    /// @param coinType The coin type.
    /// @return True if the associated address is not empty.
    function hasAddr(
        bytes32 node,
        uint256 coinType
    ) external view returns (bool);
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IABIResolver
/// @notice Profile interface for EIP-205 ABI records (`ABI(node, contentTypes) => (contentType, bytes)`).
/// @dev Ported verbatim-in-intent from
///      reference/ens-contracts/contracts/resolvers/profiles/IABIResolver.sol.
///      Pragma raised from `>=0.8.4` to `^0.8.26` per Phase 4 D-11.
interface IABIResolver {
    event ABIChanged(bytes32 indexed node, uint256 indexed contentType);

    /// Returns the ABI associated with an ENS node.
    /// Defined in EIP205.
    /// @param node The ENS node to query
    /// @param contentTypes A bitwise OR of the ABI formats accepted by the caller.
    /// @return contentType The content type of the return value
    /// @return data The ABI data
    function ABI(
        bytes32 node,
        uint256 contentTypes
    ) external view returns (uint256, bytes memory);
}

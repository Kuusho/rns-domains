// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IAddressResolver
/// @notice Interface for the multicoin `addr(node, coinType) => bytes` lookup (ENSIP-9).
/// @dev Ported verbatim-in-intent from
///      reference/ens-contracts/contracts/resolvers/profiles/IAddressResolver.sol.
///      Pragma raised from `>=0.8.4` to `^0.8.26` per Phase 4 D-11.
interface IAddressResolver {
    event AddressChanged(
        bytes32 indexed node,
        uint256 coinType,
        bytes newAddress
    );

    function addr(
        bytes32 node,
        uint256 coinType
    ) external view returns (bytes memory);
}

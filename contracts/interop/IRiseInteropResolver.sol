// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IRiseInteropResolver — interface for the ERC-7930 interop-address view.
/// @notice Resolves a .rise node to an ERC-7930 interoperable-address encoding of
///         its primary EVM address. INTEROP-01 / D-09. Read-only; standalone.
interface IRiseInteropResolver {
    /// @notice The node has no resolver set in the registry.
    error NoResolver(bytes32 node);

    /// @notice The node resolves to no primary address (addr(node) == 0). D-11:
    ///         revert rather than encode an address-less / zero blob (mirrors
    ///         ENSIP19.EmptyAddress posture).
    error NoPrimaryAddress(bytes32 node);

    /// @notice Returns the ERC-7930 interoperable-address encoding of `node`'s
    ///         primary EVM address on the configured chain.
    /// @param node The .rise namehash to resolve.
    /// @return The ERC-7930 binary interop address.
    function interopAddress(bytes32 node) external view returns (bytes memory);

    /// @notice The chain id baked into every encoding (constructor-injected, D-10).
    function chainId() external view returns (uint256);
}

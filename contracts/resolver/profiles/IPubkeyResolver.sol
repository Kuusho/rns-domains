// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IPubkeyResolver
/// @notice Profile interface for EIP-619 SECP256k1 public key records.
/// @dev Ported verbatim-in-intent from
///      reference/ens-contracts/contracts/resolvers/profiles/IPubkeyResolver.sol.
///      Pragma raised from `>=0.8.4` to `^0.8.26` per Phase 4 D-11.
interface IPubkeyResolver {
    event PubkeyChanged(bytes32 indexed node, bytes32 x, bytes32 y);

    /// Returns the SECP256k1 public key associated with an ENS node.
    /// Defined in EIP 619.
    /// @param node The ENS node to query
    /// @return x The X coordinate of the curve point for the public key.
    /// @return y The Y coordinate of the curve point for the public key.
    function pubkey(bytes32 node) external view returns (bytes32 x, bytes32 y);
}

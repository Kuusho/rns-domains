// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IDefaultReverseRegistrar — write-side interface for the default
///        (chain-agnostic) reverse registrar.
/// @notice Ported verbatim from ENS reference v1.7.0 (pragma bumped from ^0.8.4
///         to ^0.8.26 — RNS-wide).
interface IDefaultReverseRegistrar {
    /// @notice Sets the `nameForAddr()` record for the calling account.
    ///
    /// @param name The name to set.
    function setName(string memory name) external;

    /// @notice Sets the `nameForAddr()` record for the addr provided account using a signature.
    ///
    /// @param addr The address to set the name for.
    /// @param name The name to set.
    /// @param signatureExpiry Date when the signature expires.
    /// @param signature The signature from the addr.
    function setNameForAddrWithSignature(
        address addr,
        uint256 signatureExpiry,
        string memory name,
        bytes memory signature
    ) external;

    function setNameForAddr(address addr, string memory name) external;
}

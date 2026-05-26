// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IStandaloneReverseRegistrar — read-side interface for a standalone
///        reverse registrar.
/// @notice Ported verbatim from ENS reference v1.7.0 (pragma bumped from ^0.8.4
///         to ^0.8.26 — RNS-wide).
interface IStandaloneReverseRegistrar {
    /// @notice Emitted when the name for an address is changed.
    ///
    /// @param addr The address of the reverse record.
    /// @param name The name of the reverse record.
    event NameForAddrChanged(address indexed addr, string name);

    /// @notice Returns the name for an address.
    ///
    /// @param addr The address to get the name for.
    /// @return The name for the address.
    function nameForAddr(address addr) external view returns (string memory);
}

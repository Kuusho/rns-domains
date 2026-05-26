//SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IPriceOracle — frozen pricing surface for `.rise` registration and renewal.
/// @notice Ported verbatim from ENS reference v1.7.0
///         (`contracts/ethregistrar/IPriceOracle.sol`); only the pragma is bumped
///         to match the RNS-wide solc setting (Phase 4 D-11). Surface — the
///         `Price` struct and the `price()` signature — is identical to the
///         reference so any future swap-in oracle (Pyth / RedStone / native)
///         is a drop-in.
interface IPriceOracle {
    struct Price {
        uint256 base;
        uint256 premium;
    }

    /// @dev Returns the price to register or renew a name.
    /// @param name The name being registered or renewed.
    /// @param expires When the name presently expires (0 if this is a new registration).
    /// @param duration How long the name is being registered or extended for, in seconds.
    /// @return base premium tuple of base price + premium price
    function price(
        string calldata name,
        uint256 expires,
        uint256 duration
    ) external view returns (Price calldata);
}

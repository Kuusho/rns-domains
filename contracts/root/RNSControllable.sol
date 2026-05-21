// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title RNSControllable — owner/controller access mixin.
/// @notice An access-control base contract that layers a set of named
///         "controllers" on top of OpenZeppelin's single-owner model: the
///         owner appoints and revokes controllers, and the `onlyController`
///         modifier gates the privileged operations of any contract that
///         inherits this mixin.
/// @dev Clean-room re-implementation of ENS's `Controllable` (D-06). Inherited
///      by `RNSRoot`, where it gates TLD creation: only addresses the owner has
///      registered as controllers may create a `.rise`-style TLD. The revert
///      string in `onlyController` is byte-for-byte ENS-compatible and frozen
///      by D-07 — the ported `TestRoot` conformance suite asserts it exactly.
contract RNSControllable is Ownable {
    /// @notice Whether an address is currently a registered controller.
    mapping(address => bool) public controllers;

    /// @notice Emitted when a controller is registered or de-registered.
    /// @param controller The address whose controller status changed.
    /// @param enabled True when the address became a controller, false when
    ///        revoked.
    event ControllerChanged(address indexed controller, bool enabled);

    /// @dev Restricts a function to addresses registered via `setController`.
    ///      The reason string is frozen by D-07 — the conformance suite asserts
    ///      it byte-for-byte.
    modifier onlyController() {
        require(
            controllers[msg.sender],
            "Controllable: Caller is not a controller"
        );
        _;
    }

    /// @notice Registers or de-registers a controller. Owner-only.
    /// @param controller The address to register or revoke.
    /// @param enabled True to register the address as a controller, false to
    ///        revoke it.
    function setController(
        address controller,
        bool enabled
    ) public onlyOwner {
        controllers[controller] = enabled;
        emit ControllerChanged(controller, enabled);
    }
}

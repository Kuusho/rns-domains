// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RiseRegistrar} from "./RiseRegistrar.sol";
import {RNSControllable} from "../root/RNSControllable.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

/// @title RegistrarSecurityController — break-glass controller for the RiseRegistrar.
/// @notice Pass-through security wrapper that holds the `RiseRegistrar` owner key.
///         The owner (in production, a multisig) can authorise or revoke
///         registrar controllers, change the registrar's resolver, and hand the
///         registrar's ownership elsewhere through this contract; a separate set
///         of security accounts can emergency-disable a compromised registrar
///         controller without ever holding the registrar's owner key.
/// @dev Clean-room re-implementation of ENS's same-named contract (Phase 2 D-06).
///      Deliberately un-prefixed — Phase 2 D-11 / CONTEXT.md `<specifics>`
///      establish that this is the registrar-side analogue of the root-side
///      `RNSRootSecurityController`, and the un-prefixed name reflects it being
///      part of the registrar product layer (not the RNS infrastructure layer).
///      Inherits the Phase 2 `RNSControllable` mixin (NOT the reference's
///      `Controllable`) for the `onlyController` emergency path — the revert
///      string `"Controllable: Caller is not a controller"` is frozen by
///      Phase 2 D-07 and asserted byte-for-byte by the ported test 3.
contract RegistrarSecurityController is RNSControllable, ERC165 {

    /// @notice The RiseRegistrar this contract manages.
    RiseRegistrar public registrar;

    /// @notice Constructs the security controller and locks in the registrar reference.
    /// @param _registrar The RiseRegistrar to manage.
    constructor(RiseRegistrar _registrar) {
        registrar = _registrar;
    }

    /// @notice Grants registrar controller permissions.
    /// @dev Owner-only. Forwards to `RiseRegistrar.addController` which is
    ///      `onlyOwner` on the registrar — works because this contract IS the
    ///      registrar's owner after the activation gate's `transferOwnership`.
    /// @param controller The registrar controller to add.
    function addRegistrarController(address controller) external onlyOwner {
        registrar.addController(controller);
    }

    /// @notice Revokes registrar controller permissions.
    /// @dev Owner-only.
    /// @param controller The registrar controller to remove.
    function removeRegistrarController(address controller) external onlyOwner {
        registrar.removeController(controller);
    }

    /// @notice Sets the resolver for the `.rise` TLD node on the RNS registry.
    /// @dev Owner-only. Forwards to `RiseRegistrar.setResolver` which writes
    ///      `rns.setResolver(baseNode, resolver)`.
    /// @param resolver The resolver address to set.
    function setRegistrarResolver(address resolver) external onlyOwner {
        registrar.setResolver(resolver);
    }

    /// @notice Transfers ownership of the underlying RiseRegistrar to a new
    ///         account, breaking the SC's wrapper relationship.
    /// @dev Owner-only. `public virtual` (not `external`) — matches the
    ///      reference posture so future-phase subclasses can override without
    ///      breaking the ABI.
    /// @param newOwner The new owner for the registrar.
    function transferRegistrarOwnership(address newOwner) public virtual onlyOwner {
        registrar.transferOwnership(newOwner);
    }

    /// @notice Removes a registrar controller in emergencies.
    /// @dev Controller-only — the break-glass path. Callable by any address
    ///      the SC owner has registered via the inherited
    ///      `RNSControllable.setController(address,bool)`. The revert string
    ///      on a non-controller caller is `"Controllable: Caller is not a controller"`
    ///      (frozen by Phase 2 D-07).
    /// @param controller The registrar controller to remove.
    function disableRegistrarController(address controller) external onlyController {
        registrar.removeController(controller);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RNSRoot} from "./RNSRoot.sol";
import {RNS} from "../registry/RNS.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

/// @title RNSRootSecurityController — break-glass TLD removal controller.
/// @notice An emergency controller for the RNS root: its single privileged
///         action, `disableTLD`, takes ownership of a top-level domain to
///         itself and clears that TLD's resolver. It can only *remove* a TLD —
///         never assign one.
/// @dev Clean-room re-implementation of ENS's `RootSecurityController` (D-06).
///      The removal-only guarantee (CORE-05) is STRUCTURAL, not a runtime
///      check: this contract exposes exactly one external mutator, `disableTLD`,
///      and deliberately no function that assigns a TLD to an arbitrary
///      address. Do not add an assign path — the absence of one *is* the
///      guarantee. It is registered as a controller on `RNSRoot` so it can call
///      `RNSRoot.setSubnodeOwner`. `is ERC165` so `supportsInterface(IERC165)`
///      is true with no extra code.
contract RNSRootSecurityController is Ownable, ERC165 {
    /// @dev The registry root node — all TLDs are subnodes of `0x0`.
    bytes32 private constant ROOT_NODE = bytes32(0);

    /// @notice The root contract this controller acts on.
    RNSRoot public root;

    /// @notice The RNS registry, read from the root contract at construction.
    RNS public rns;

    /// @notice Constructs the security controller.
    /// @param _root The root contract to manage. Its `rns` reference is read
    ///        and stored for resolver clearing.
    constructor(RNSRoot _root) {
        root = _root;
        rns = _root.rns();
    }

    /// @notice Emergency-disables a TLD: takes ownership of the TLD node to this
    ///         contract and clears its resolver. Owner-only. This is the only
    ///         mutating action this contract exposes — there is no assign path.
    /// @param label The labelhash of the TLD to disable.
    function disableTLD(bytes32 label) external onlyOwner {
        root.setSubnodeOwner(label, address(this));
        rns.setResolver(
            keccak256(abi.encodePacked(ROOT_NODE, label)),
            address(0)
        );
    }
}

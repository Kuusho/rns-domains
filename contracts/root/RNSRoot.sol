// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RNS} from "../registry/RNS.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {RNSControllable} from "./RNSControllable.sol";

/// @title RNSRoot — owner of the registry root node.
/// @notice The contract that owns the RNS registry root node `0x0`. It is the
///         sole creator of top-level domains: a controller calls
///         `setSubnodeOwner(label, owner)` to assign a TLD, and the owner can
///         permanently `lock` a label so that TLD can never be reassigned.
/// @dev Clean-room re-implementation of ENS's `Root` (D-06). Holds an `RNS`
///      registry reference (named `rns`, not `ens`, per D-11) and, once the
///      registry's root node `0x0` is transferred to this contract, holds the
///      sole privileged write path into it. TLD creation is gated by
///      `onlyController` (from `RNSControllable`); the locked-TLD `require` is
///      intentionally bare so the conformance suite's revert-without-reason
///      assertion passes byte-for-byte (D-07).
contract RNSRoot is Ownable, RNSControllable {
    /// @dev The registry root node — all TLDs are subnodes of `0x0`.
    bytes32 private constant ROOT_NODE = bytes32(0);

    /// @dev The ERC-165 meta interface id — `bytes4(keccak256("supportsInterface(bytes4)"))`.
    bytes4 private constant INTERFACE_META_ID = 0x01ffc9a7;

    /// @notice The RNS registry this contract owns the root node of.
    RNS public rns;

    /// @notice Whether a TLD label is permanently locked against reassignment.
    mapping(bytes32 => bool) public locked;

    /// @notice Emitted when a TLD label is permanently locked.
    /// @param label The labelhash of the locked TLD.
    event TLDLocked(bytes32 indexed label);

    /// @notice Constructs the root contract.
    /// @param _rns The RNS registry whose root node `0x0` this contract will own.
    constructor(RNS _rns) {
        rns = _rns;
    }

    /// @notice Creates or reassigns a top-level domain. Controller-only.
    /// @dev Reverts (without a reason) if `label` has been permanently locked.
    /// @param label The labelhash of the TLD to assign.
    /// @param owner The address to make the owner of the TLD node.
    function setSubnodeOwner(
        bytes32 label,
        address owner
    ) external onlyController {
        require(!locked[label]);
        rns.setSubnodeOwner(ROOT_NODE, label, owner);
    }

    /// @notice Sets the resolver of the registry root node `0x0`. Owner-only.
    /// @param resolver The resolver address to assign to the root node.
    function setResolver(address resolver) external onlyOwner {
        rns.setResolver(ROOT_NODE, resolver);
    }

    /// @notice Permanently locks a TLD label so it can never be reassigned via
    ///         `setSubnodeOwner`. Owner-only. There is no unlock path.
    /// @param label The labelhash of the TLD to lock.
    function lock(bytes32 label) external onlyOwner {
        emit TLDLocked(label);
        locked[label] = true;
    }

    /// @notice ERC-165 introspection — reports support for the ERC-165 meta
    ///         interface only.
    /// @param interfaceID The interface identifier to query.
    /// @return True if `interfaceID` is the ERC-165 meta interface id.
    function supportsInterface(
        bytes4 interfaceID
    ) external pure returns (bool) {
        return interfaceID == INTERFACE_META_ID;
    }
}

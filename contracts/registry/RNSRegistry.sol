// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RNS} from "./RNS.sol";

/// @title RNSRegistry — the RiseChain Name Service registry.
/// @notice The authorization spine of RNS: a flat `node -> {owner, resolver, ttl}`
///         map that every downstream contract reads and writes through the `RNS`
///         interface. Holds no business logic — pure ownership and authorization.
/// @dev Clean-room re-implementation of ENS's `ENSRegistry` (D-06). The bodies and
///      storage layout below are RNS-authored, but every observable behavior —
///      the record model, operator approvals, subnode-owner authorization, the
///      keccak256 subnode derivation, and the `owner()` self-reference clause —
///      is byte-for-byte ENS-compatible and frozen by D-07.
contract RNSRegistry is RNS {
    /// @notice The owner, resolver, and TTL stored for a single node.
    struct Record {
        address owner;
        address resolver;
        uint64 ttl;
    }

    /// @dev node -> its {owner, resolver, ttl} record.
    mapping(bytes32 => Record) private records;

    /// @dev owner -> operator -> whether the operator may manage all of the
    ///      owner's nodes.
    mapping(address => mapping(address => bool)) private operators;

    /// @dev Restricts a mutator to the node's owner or one of its approved
    ///      operators. The `require` is intentionally bare (no reason string):
    ///      an unauthorized call reverts without a reason, matching the frozen
    ///      ENS behavior (D-07) the conformance suite asserts.
    modifier authorised(bytes32 node) {
        address nodeOwner = records[node].owner;
        require(nodeOwner == msg.sender || operators[nodeOwner][msg.sender]);
        _;
    }

    /// @notice Constructs the registry, seating the deployer as the owner of the
    ///         root node `0x0`.
    constructor() {
        records[bytes32(0)].owner = msg.sender;
    }

    /// @inheritdoc RNS
    function setRecord(
        bytes32 node,
        address owner,
        address resolver,
        uint64 ttl
    ) external virtual override {
        setOwner(node, owner);
        _setResolverAndTTL(node, resolver, ttl);
    }

    /// @inheritdoc RNS
    function setSubnodeRecord(
        bytes32 node,
        bytes32 label,
        address owner,
        address resolver,
        uint64 ttl
    ) external virtual override {
        bytes32 subnode = setSubnodeOwner(node, label, owner);
        _setResolverAndTTL(subnode, resolver, ttl);
    }

    /// @inheritdoc RNS
    /// @dev `public` so `setRecord` can call it internally.
    function setOwner(
        bytes32 node,
        address owner
    ) public virtual override authorised(node) {
        _setOwner(node, owner);
        emit Transfer(node, owner);
    }

    /// @inheritdoc RNS
    /// @dev `public` so `setSubnodeRecord` can call it internally. The subnode
    ///      is derived as `keccak256(abi.encodePacked(node, label))` — the exact
    ///      namehash derivation, frozen by D-07.
    function setSubnodeOwner(
        bytes32 node,
        bytes32 label,
        address owner
    ) public virtual override authorised(node) returns (bytes32) {
        bytes32 subnode = keccak256(abi.encodePacked(node, label));
        _setOwner(subnode, owner);
        emit NewOwner(node, label, owner);
        return subnode;
    }

    /// @inheritdoc RNS
    /// @dev Standalone setter — emits `NewResolver` unconditionally before
    ///      storing, matching the frozen ENS behavior.
    function setResolver(
        bytes32 node,
        address resolver
    ) public virtual override authorised(node) {
        emit NewResolver(node, resolver);
        records[node].resolver = resolver;
    }

    /// @inheritdoc RNS
    /// @dev Standalone setter — emits `NewTTL` unconditionally before storing,
    ///      matching the frozen ENS behavior.
    function setTTL(
        bytes32 node,
        uint64 ttl
    ) public virtual override authorised(node) {
        emit NewTTL(node, ttl);
        records[node].ttl = ttl;
    }

    /// @inheritdoc RNS
    function setApprovalForAll(
        address operator,
        bool approved
    ) external virtual override {
        operators[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    /// @inheritdoc RNS
    /// @dev When the registry itself is the stored owner, `owner()` reads back
    ///      `address(0)` — the ENS self-reference clause, preserved per D-07.
    function owner(
        bytes32 node
    ) public view virtual override returns (address) {
        address nodeOwner = records[node].owner;
        if (nodeOwner == address(this)) {
            return address(0);
        }
        return nodeOwner;
    }

    /// @inheritdoc RNS
    function resolver(
        bytes32 node
    ) public view virtual override returns (address) {
        return records[node].resolver;
    }

    /// @inheritdoc RNS
    function ttl(bytes32 node) public view virtual override returns (uint64) {
        return records[node].ttl;
    }

    /// @inheritdoc RNS
    function recordExists(
        bytes32 node
    ) public view virtual override returns (bool) {
        return records[node].owner != address(0);
    }

    /// @inheritdoc RNS
    function isApprovedForAll(
        address owner,
        address operator
    ) external view virtual override returns (bool) {
        return operators[owner][operator];
    }

    /// @dev Writes a node's owner without emitting an event — callers emit the
    ///      appropriate `Transfer` / `NewOwner` event themselves.
    function _setOwner(bytes32 node, address owner) internal virtual {
        records[node].owner = owner;
    }

    /// @dev Sets the resolver and TTL for a node, emitting `NewResolver` /
    ///      `NewTTL` ONLY when the value actually changes. This conditional-emit
    ///      behavior backs `setRecord` / `setSubnodeRecord` and differs from the
    ///      standalone `setResolver` / `setTTL` setters — both behaviors are
    ///      observable and frozen by D-07.
    function _setResolverAndTTL(
        bytes32 node,
        address resolver,
        uint64 ttl
    ) internal {
        if (resolver != records[node].resolver) {
            records[node].resolver = resolver;
            emit NewResolver(node, resolver);
        }

        if (ttl != records[node].ttl) {
            records[node].ttl = ttl;
            emit NewTTL(node, ttl);
        }
    }
}

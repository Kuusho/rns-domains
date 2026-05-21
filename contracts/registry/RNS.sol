// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title RNS — RiseChain Name Service registry interface.
/// @notice The frozen, ENS-compatible external interface of the RNS registry.
///         Every downstream RNS contract (registrar, controllers, resolvers)
///         reads and writes the registry through this interface.
/// @dev Clean-room re-implementation of ENS's `ENS` interface (D-06). The
///      function signatures and the event topic layout below are byte-for-byte
///      ENS-compatible and MUST NOT change (D-07): the spec §5 dependency chain
///      assumes an ENS-compatible registry, so this surface is permanently
///      frozen. Re-implementation freedom applies only to contract bodies.
interface RNS {
    /// @notice Emitted when the owner of a node assigns a new owner to one of
    ///         its subnodes.
    /// @param node The parent node.
    /// @param label The labelhash of the subnode being assigned.
    /// @param owner The address of the subnode's new owner.
    event NewOwner(bytes32 indexed node, bytes32 indexed label, address owner);

    /// @notice Emitted when the owner of a node transfers ownership to a new
    ///         account.
    /// @param node The node whose ownership changed.
    /// @param owner The address of the node's new owner.
    event Transfer(bytes32 indexed node, address owner);

    /// @notice Emitted when the resolver for a node changes.
    /// @param node The node whose resolver changed.
    /// @param resolver The address of the node's new resolver.
    event NewResolver(bytes32 indexed node, address resolver);

    /// @notice Emitted when the TTL of a node changes.
    /// @param node The node whose TTL changed.
    /// @param ttl The node's new TTL, in seconds.
    event NewTTL(bytes32 indexed node, uint64 ttl);

    /// @notice Emitted when an operator is granted or revoked blanket rights
    ///         over all of an owner's nodes.
    /// @param owner The address whose records the operator may manage.
    /// @param operator The address being granted or revoked operator rights.
    /// @param approved True when the operator is approved, false when revoked.
    event ApprovalForAll(
        address indexed owner,
        address indexed operator,
        bool approved
    );

    /// @notice Sets the owner, resolver, and TTL for an existing node.
    function setRecord(
        bytes32 node,
        address owner,
        address resolver,
        uint64 ttl
    ) external;

    /// @notice Creates or updates a subnode and sets its owner, resolver, and TTL.
    function setSubnodeRecord(
        bytes32 node,
        bytes32 label,
        address owner,
        address resolver,
        uint64 ttl
    ) external;

    /// @notice Creates or transfers a subnode and assigns its owner.
    /// @return The namehash of the affected subnode.
    function setSubnodeOwner(
        bytes32 node,
        bytes32 label,
        address owner
    ) external returns (bytes32);

    /// @notice Sets the resolver address for a node.
    function setResolver(bytes32 node, address resolver) external;

    /// @notice Transfers ownership of a node to a new address.
    function setOwner(bytes32 node, address owner) external;

    /// @notice Sets the TTL, in seconds, for a node.
    function setTTL(bytes32 node, uint64 ttl) external;

    /// @notice Grants or revokes blanket operator rights over the caller's nodes.
    function setApprovalForAll(address operator, bool approved) external;

    /// @notice Returns the address that owns the specified node.
    function owner(bytes32 node) external view returns (address);

    /// @notice Returns the resolver address for the specified node.
    function resolver(bytes32 node) external view returns (address);

    /// @notice Returns the TTL, in seconds, of the specified node.
    function ttl(bytes32 node) external view returns (uint64);

    /// @notice Returns whether a record exists for the specified node.
    function recordExists(bytes32 node) external view returns (bool);

    /// @notice Returns whether `operator` may manage all of `owner`'s nodes.
    function isApprovedForAll(
        address owner,
        address operator
    ) external view returns (bool);
}

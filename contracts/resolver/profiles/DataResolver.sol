// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ResolverBase} from "../ResolverBase.sol";
import {IDataResolver} from "./IDataResolver.sol";

/// @title DataResolver
/// @notice Profile mixin for generic (node, key) => bytes data records (ENSIP-24).
/// @dev Ported verbatim-in-intent from
///      reference/ens-contracts/contracts/resolvers/profiles/DataResolver.sol.
///      The `_afterSetData` hook is preserved as a no-op virtual; the reference's
///      `SupportedDataKeys` mixin would override it, but per RESEARCH Open
///      Question 2 the mixin is not ported in Phase 4.
abstract contract DataResolver is IDataResolver, ResolverBase {
    mapping(uint64 => mapping(bytes32 node => mapping(string key => bytes data)))
        private versionable_dataStore;

    /// @notice Sets the data associated with the key, `key` for a specific `node`.
    /// May only be called by the owner of that node in the ENS registry.
    /// @param node The node to update.
    /// @param key The key to set.
    /// @param value The arbitrary `bytes` data to set.
    function setData(
        bytes32 node,
        string calldata key,
        bytes calldata value
    ) external virtual authorised(node) {
        versionable_dataStore[recordVersions[node]][node][key] = value;
        _afterSetData(node, key, value);
        emit DataChanged(node, key, key, value);
    }

    /// @dev Hook called after data is set. Override to add custom behavior.
    function _afterSetData(
        bytes32 node,
        string memory key,
        bytes memory value
    ) internal virtual {}

    /// @notice For a specific `node`, get the data associated with the key, `key`.
    /// @param node The node (namehash) for which data is being fetched.
    /// @param key The key.
    /// @return The associated arbitrary `bytes` data.
    function data(
        bytes32 node,
        string calldata key
    ) external view returns (bytes memory) {
        return versionable_dataStore[recordVersions[node]][node][key];
    }

    function supportsInterface(
        bytes4 interfaceID
    ) public view virtual override returns (bool) {
        return
            interfaceID == type(IDataResolver).interfaceId ||
            super.supportsInterface(interfaceID);
    }
}

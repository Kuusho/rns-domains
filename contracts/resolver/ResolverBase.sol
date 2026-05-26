// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IVersionableResolver} from "./profiles/IVersionableResolver.sol";

/// @title ResolverBase
/// @notice Abstract base for every concrete resolver. Provides the per-node
///         `recordVersions` counter, the `authorised(node)` modifier, and the
///         `isAuthorised(bytes32)` override hook.
/// @dev Ported verbatim-in-intent from ENS reference ResolverBase.sol.
///      RNS posture: pragma ^0.8.26 (D-11); bare-revert authorised (D-12);
///      ERC-165 via OZ inheritance (D-13).
abstract contract ResolverBase is ERC165, IVersionableResolver {
    mapping(bytes32 => uint64) public recordVersions;

    function isAuthorised(bytes32 node) internal view virtual returns (bool);

    modifier authorised(bytes32 node) {
        require(isAuthorised(node));
        _;
    }

    /// @notice Increments the record version for `node`, atomically invalidating
    ///         every prior-version write across every profile mixin.
    function clearRecords(bytes32 node) public virtual authorised(node) {
        recordVersions[node]++;
        emit VersionChanged(node, recordVersions[node]);
    }

    function supportsInterface(
        bytes4 interfaceID
    ) public view virtual override returns (bool) {
        return
            interfaceID == type(IVersionableResolver).interfaceId ||
            super.supportsInterface(interfaceID);
    }
}

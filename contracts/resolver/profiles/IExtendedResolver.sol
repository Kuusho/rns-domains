// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IExtendedResolver
/// @notice ENSIP-10 `resolve(name, data)` interface — universal-resolver routing
///         entrypoint. RNS uses this only on `RiseOwnedResolver` (D-04) so the
///         `.rise` node advertises ENSIP-10 compatibility.
/// @dev Ported verbatim-in-intent from
///      reference/ens-contracts/contracts/resolvers/profiles/IExtendedResolver.sol.
///      Pragma raised from `^0.8.4` to `^0.8.26` per Phase 4 D-11.
interface IExtendedResolver {
    function resolve(
        bytes memory name,
        bytes memory data
    ) external view returns (bytes memory);
}

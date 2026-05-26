// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title ExtendedResolver
/// @notice ENSIP-10 `resolve(name, data)` standalone stub. Does NOT inherit
///         `ResolverBase` (matches reference). Intended to be inherited ONLY by
///         `RiseOwnedResolver` (D-04). The implementation forwards the call to
///         `address(this)` via `staticcall(data)` so that any concrete profile
///         method on the inheriting resolver is reachable through the universal
///         resolver routing path.
/// @dev Ported verbatim-in-intent from
///      reference/ens-contracts/contracts/resolvers/profiles/ExtendedResolver.sol.
///      Pragma raised from `^0.8.4` to `^0.8.26` per Phase 4 D-11. No
///      `supportsInterface` override — the inheriting resolver advertises
///      `IExtendedResolver.interfaceId` from its own consolidated override.
contract ExtendedResolver {
    function resolve(
        bytes memory /* name */,
        bytes memory data
    ) external view returns (bytes memory) {
        (bool success, bytes memory result) = address(this).staticcall(data);
        if (success) {
            return result;
        } else {
            // Revert with the reason provided by the call
            assembly {
                revert(add(result, 0x20), mload(result))
            }
        }
    }
}

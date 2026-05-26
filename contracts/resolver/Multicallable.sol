// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IMulticallable} from "./IMulticallable.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

/// @title Multicallable
/// @notice Abstract mixin providing `multicall(bytes[])` and
///         `multicallWithNodeCheck(bytes32, bytes[])`.
/// @dev Ported verbatim-in-intent from ENS reference Multicallable.sol.
///      Critical posture (see 04-RESEARCH.md Pitfall 4 + Pitfall 8):
///        * `data` is `bytes calldata` so the `data[i][4:36]` slice syntax works.
///        * `multicall(bytes[])` passes bytes32(0) (unguarded); each inner
///          call's own `authorised(node)` modifier carries authorisation.
///        * `multicallWithNodeCheck` is the privileged-caller API: Phase 6's
///          trusted controllers MUST use this overload to prevent cross-name
///          escalation. The require-with-message is kept verbatim from
///          reference; the bare-revert posture (D-12) applies only to
///          `authorised(node)`.
abstract contract Multicallable is IMulticallable, ERC165 {
    function _multicall(bytes32 nodehash, bytes[] calldata data) internal returns (bytes[] memory results) {
        results = new bytes[](data.length);
        for (uint256 i = 0; i < data.length; i++) {
            if (nodehash != bytes32(0)) {
                bytes32 txNamehash = bytes32(data[i][4:36]);
                require(
                    txNamehash == nodehash,
                    "multicall: All records must have a matching namehash"
                );
            }
            (bool success, bytes memory result) = address(this).delegatecall(data[i]);
            require(success);
            results[i] = result;
        }
        return results;
    }

    function multicallWithNodeCheck(bytes32 nodehash, bytes[] calldata data) external returns (bytes[] memory results) {
        return _multicall(nodehash, data);
    }

    function multicall(bytes[] calldata data) public override returns (bytes[] memory results) {
        return _multicall(bytes32(0), data);
    }

    function supportsInterface(
        bytes4 interfaceID
    ) public view virtual override returns (bool) {
        return
            interfaceID == type(IMulticallable).interfaceId ||
            super.supportsInterface(interfaceID);
    }
}

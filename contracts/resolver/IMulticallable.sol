// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IMulticallable
/// @notice Interface for batching multiple resolver writes into a single call.
/// @dev Ported verbatim from
///      reference/ens-contracts/contracts/resolvers/IMulticallable.sol.
///      `multicall(bytes[])` is the unguarded fan-out (the inner-call modifier
///      enforces per-call authorisation). `multicallWithNodeCheck(bytes32, bytes[])`
///      is the privileged-caller API: it asserts every inner call's `data[i][4:36]`
///      slice (the bytes32 node argument) matches the supplied `nodehash` — see
///      Multicallable._multicall for the load-bearing guard, and 04-RESEARCH.md
///      Pitfall 4 for the cross-name escalation it prevents.
interface IMulticallable {
    function multicall(
        bytes[] calldata data
    ) external returns (bytes[] memory results);

    function multicallWithNodeCheck(
        bytes32,
        bytes[] calldata data
    ) external returns (bytes[] memory results);
}

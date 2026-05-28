//SPDX-License-Identifier: MIT
pragma solidity >=0.8.17 <0.9.0;

/// @title MockNonToken — a contract that does NOT implement the ERC-20/721
///         balance-read selector (0x70a08231).
/// @notice Used to exercise the SubdomainRegistrar gate's non-implementing-token
///         path (RESEARCH Pattern 3 / threat T-7-08): the registrar staticcalls
///         the balance-read selector and must treat a token that does not answer
///         it as balance 0 (never reverting / bricking the gate path). This mock
///         deliberately exposes only an unrelated function so the staticcall
///         finds no matching selector and returns empty data.
contract MockNonToken {
    /// @notice An unrelated function so the contract has real bytecode but no
    ///         balance-read selector to answer the gate staticcall.
    function ping() external pure returns (bool) {
        return true;
    }
}

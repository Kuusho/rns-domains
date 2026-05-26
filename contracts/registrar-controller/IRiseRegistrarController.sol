// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPriceOracle} from "./IPriceOracle.sol";

/// @title IRiseRegistrarController — public registration entry point interface.
/// @notice Ported from ENS reference v1.7.0 (`IETHRegistrarController.sol`); pragma
///         bumped to ^0.8.26. Renamed `IETHRegistrarController` →
///         `IRiseRegistrarController` per Phase 2 D-11 RNS naming convention.
///         Surface — the `Registration` struct + 6 external functions — is
///         identical to the reference so any future swap-in controller is a
///         drop-in for downstream tooling.
interface IRiseRegistrarController {
    /// @notice The parameters for a registration.
    struct Registration {
        string label;
        address owner;
        uint256 duration;
        bytes32 secret;
        address resolver;
        bytes[] data;
        uint8 reverseRecord;
        bytes32 referrer;
    }

    function rentPrice(string memory label, uint256 duration)
        external
        view
        returns (IPriceOracle.Price memory);

    function available(string memory label) external returns (bool);

    function makeCommitment(Registration memory registration)
        external
        pure
        returns (bytes32 commitment);

    function commit(bytes32 commitment) external;

    function register(Registration memory registration) external payable;

    function renew(string calldata label, uint256 duration, bytes32 referrer)
        external
        payable;
}

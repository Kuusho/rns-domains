// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRiseStats} from "./IRiseStats.sol";

/// @dev Minimal local views over the source counters. RiseStats reads ONLY these
///      plain public counters — never any expiry-masking ownership/expiry getter
///      that reverts on lapsed tokens (Pitfall 7), so stats() never reverts.
interface IRegistrarCounters {
    function registrations() external view returns (uint256);
    function renewals() external view returns (uint256);
    function totalSupply() external view returns (uint256);
}
interface ISubdomainCounter {
    function totalSubdomains() external view returns (uint256);
}
interface IControllerVolume {
    function cumulativeVolume() external view returns (uint256);
}

/// @title RiseStats — read-only aggregator over the four RNS global counters (D-05).
/// @notice Pure read aggregation; one call powers the frontend /stats page.
///         Reads registrations/renewals/totalSupply from RiseRegistrar,
///         totalSubdomains from SubdomainRegistrar, cumulativeVolume from
///         RiseRegistrarController. Source addresses are constructor-injected
///         (no hardcoded addresses — fork posture).
contract RiseStats is IRiseStats {
    IRegistrarCounters public immutable registrar;
    ISubdomainCounter public immutable subdomainRegistrar;
    IControllerVolume public immutable controller;

    /// @param _registrar RiseRegistrar (registrations/renewals/totalSupply).
    /// @param _subdomainRegistrar SubdomainRegistrar (totalSubdomains).
    /// @param _controller RiseRegistrarController (cumulativeVolume).
    constructor(
        IRegistrarCounters _registrar,
        ISubdomainCounter _subdomainRegistrar,
        IControllerVolume _controller
    ) {
        registrar = _registrar;
        subdomainRegistrar = _subdomainRegistrar;
        controller = _controller;
    }

    /// @inheritdoc IRiseStats
    function stats() external view returns (Stats memory) {
        return Stats({
            registrations: registrar.registrations(),
            renewals: registrar.renewals(),
            totalSubdomains: subdomainRegistrar.totalSubdomains(),
            cumulativeVolume: controller.cumulativeVolume(),
            currentSupply: registrar.totalSupply()
        });
    }
}

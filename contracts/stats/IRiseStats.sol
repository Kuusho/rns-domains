// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IRiseStats — interface for the RNS global-stats aggregator.
/// @notice One read returns the four global counters (+ live supply) for the
///         frontend /stats page. ENUM-02 / D-05.
interface IRiseStats {
    /// @notice The unified stats snapshot.
    /// @dev registrations/renewals/cumulativeVolume are LIFETIME counters;
    ///      totalSubdomains is a lifetime SALE count (A2 — not a live active
    ///      count); currentSupply is the live un-burned ERC721Enumerable count.
    struct Stats {
        uint256 registrations;     // RiseRegistrar.registrations
        uint256 renewals;          // RiseRegistrar.renewals
        uint256 totalSubdomains;   // SubdomainRegistrar.totalSubdomains
        uint256 cumulativeVolume;  // RiseRegistrarController.cumulativeVolume
        uint256 currentSupply;     // RiseRegistrar.totalSupply() (live)
    }

    /// @notice Returns all global counters in one call.
    function stats() external view returns (Stats memory);
}

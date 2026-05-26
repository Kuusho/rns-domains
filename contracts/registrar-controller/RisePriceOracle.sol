//SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPriceOracle} from "./IPriceOracle.sol";
import {StringUtils} from "../utils/StringUtils.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title RisePriceOracle
/// @notice Native-token, per-length, owner-mutable price oracle for `.rise`
///         names. Implements the frozen IPriceOracle surface so Phase 6's
///         RiseRegistrarController consumes it unchanged. Prices are
///         denominated directly in RiseChain's native token, wei/sec — no
///         external price-feed dependency, no fiat conversion (see PROJECT.md
///         "native-token pricing" decision + PRICE-03). The exponential
///         post-expiry premium curve is deferred: the `_premium` virtual hook
///         returns 0 in this contract and can be overridden by a future
///         subclass without changing the public surface (Phase 5 D-04).
/// @dev Storage layout: a single `uint256[5] private rentPrices` slot maps
///      length 1→[0], 2→[1], 3→[2], 4→[3], ≥5→[4] (D-01 + D-02 — no
///      length-revert; brand protection lives in Phase 6's controller). Owner
///      semantics: OZ Ownable v4 seats `msg.sender` (the deployer) as initial
///      owner; Plan 05-03's deploy script then calls `transferOwnership(owner)`
///      to hand control to the named `owner` account (D-06 — same handoff
///      pattern as Phase 4 PublicResolver / RiseOwnedResolver). ERC-165: the
///      `supportsInterface` override advertises IERC165 || IPriceOracle (D-05).
contract RisePriceOracle is IPriceOracle, Ownable {
    using StringUtils for *;

    /// @notice Per-length rent rate in wei per second. Index maps length 1→[0],
    ///         2→[1], 3→[2], 4→[3], ≥5→[4] (D-01 + D-02 — no length-revert).
    ///         Owner-mutable via {setRentPrices}. Storage is `private` and read
    ///         via the named {rentPrice} getter so callers pass a
    ///         human-readable length rather than a raw array index.
    uint256[5] private rentPrices;

    /// @notice Emitted on every successful {setRentPrices} call. Snapshot of
    ///         the entire new schedule (D-03 — no per-slot setter; bulk-only
    ///         eliminates partial-update pricing inversions). Off-chain
    ///         monitors (e.g. the R2 indexer) detect arbitrary re-pricing by
    ///         watching this event (threat T-05-02 mitigation).
    event RentPriceChanged(uint256[5] prices);

    /// @notice Seeds the initial per-length schedule. OZ Ownable v4 seats
    ///         `msg.sender` (the deployer) as the initial owner; the deploy
    ///         script calls `transferOwnership(owner)` post-construct (D-06).
    /// @param initialPrices The five per-length rent rates in wei/sec, indexed
    ///        as documented on {rentPrices}.
    constructor(uint256[5] memory initialPrices) {
        rentPrices = initialPrices;
    }

    /// @inheritdoc IPriceOracle
    function price(
        string calldata name,
        uint256 expires,
        uint256 duration
    ) public view virtual override returns (IPriceOracle.Price memory) {
        uint256 len = name.strlen();
        uint256 index = len > 5 ? 4 : (len == 0 ? 0 : len - 1);
        uint256 basePrice = rentPrices[index] * duration;
        return IPriceOracle.Price({
            base: basePrice,
            premium: _premium(name, expires, duration)
        });
    }

    /// @notice Owner-only bulk update of the per-length schedule. Emits a
    ///         full-schedule snapshot event. No per-slot setter exists by
    ///         design (D-03 — avoids partial-update pricing inversions).
    /// @param prices The new five per-length rent rates in wei/sec.
    function setRentPrices(uint256[5] calldata prices) external onlyOwner {
        rentPrices = prices;
        emit RentPriceChanged(prices);
    }

    /// @notice Read the per-length rent rate for a given length (1-5+). Length
    ///         values above 5 saturate at slot [4]; length 0 reads slot [0].
    ///         Convenience getter for off-chain tooling and Phase 6's
    ///         controller — kept explicit because the storage slot itself is
    ///         private (D-01 — Claude's Discretion locked per I-8: private
    ///         storage + named getter, since Plan 05-02 tests call this
    ///         signature directly).
    /// @param length The human-readable name length (number of UTF-8 runes).
    /// @return The wei/sec rent rate for that length.
    function rentPrice(uint256 length) external view returns (uint256) {
        uint256 index = length > 5 ? 4 : (length == 0 ? 0 : length - 1);
        return rentPrices[index];
    }

    /// @notice Virtual hook for future premium-curve subclasses (D-04).
    ///         Returns 0 in this contract — a Phase-9+
    ///         ExponentialRisePriceOracle can override without changing the
    ///         public surface. Parameters are commented-out to silence the
    ///         unused-variable warning while preserving the override signature.
    function _premium(
        string memory /* name */,
        uint256 /* expires */,
        uint256 /* duration */
    ) internal view virtual returns (uint256) {
        return 0;
    }

    /// @notice ERC-165 advertisement of IERC165 || IPriceOracle (D-05). The
    ///         function is `virtual` so future subclasses (e.g. an exponential
    ///         premium variant) can extend the advertised set without
    ///         reimplementing the base.
    function supportsInterface(bytes4 interfaceID)
        public
        view
        virtual
        returns (bool)
    {
        return
            interfaceID == type(IERC165).interfaceId ||
            interfaceID == type(IPriceOracle).interfaceId;
    }
}

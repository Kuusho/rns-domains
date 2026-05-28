// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPriceOracle} from "./IPriceOracle.sol";
import {StringUtils} from "../utils/StringUtils.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title RiseDurationPriceOracle — native-token per-length oracle with an
///        owner-tunable duration-tier discount (MYR-02 / D-07 / D-08).
/// @notice Mirrors RisePriceOracle's flat per-length base price, then applies a
///         duration-keyed discount in bps. Because the controller's _rentPrice
///         calls price() for BOTH register and renew, a duration-keyed discount
///         applies the SAME discount to renew as to register (D-07) with zero
///         controller logic. Tiers are owner-tunable up to an IMMUTABLE cap
///         (MAX_DISCOUNT_BPS), mirroring SubdomainRegistrar.FEE_CAP_BPS.
/// @dev The 1-10yr bounds + hard cap (D-06) are enforced on the CONTROLLER path,
///      NOT here — the oracle prices honestly and never clamps duration
///      (Pitfall 6: keeps the 28-day base path price-identical to the flat oracle).
contract RiseDurationPriceOracle is IPriceOracle, Ownable {
    using StringUtils for *;

    /// @notice Immutable upper bound on any discount tier: 20% (D-07).
    uint256 public constant MAX_DISCOUNT_BPS = 2000;

    /// @notice Seconds in one (365-day) year — the tier boundary unit.
    uint256 public constant SECONDS_PER_YEAR = 365 days;

    /// @notice Per-length rent rate in wei/sec, length 1->[0]..>=5->[4]. Mirrors
    ///         RisePriceOracle. Owner-mutable via setRentPrices.
    uint256[5] private rentPrices;

    /// @notice Discount in bps indexed by whole-year count: index 0 unused,
    ///         1..10 = the tiers. Default 1yr 0 / 2-3yr 500 / 4-5yr 1000 /
    ///         6-9yr 1500 / 10yr 2000. Owner-tunable up to MAX_DISCOUNT_BPS.
    uint16[11] public discountBps;

    event RentPriceChanged(uint256[5] prices);
    event DiscountsChanged(uint16[11] discounts);

    /// @notice A supplied discount tier exceeded MAX_DISCOUNT_BPS.
    error DiscountTooHigh(uint256 bps);

    constructor(uint256[5] memory initialPrices) {
        rentPrices = initialPrices;
        // Default schedule (D-07): index = whole years. 0 unused.
        discountBps = [uint16(0), 0, 500, 500, 1000, 1000, 1500, 1500, 1500, 1500, 2000];
    }

    /// @inheritdoc IPriceOracle
    function price(
        string calldata name,
        uint256 /* expires */,
        uint256 duration
    ) external view override returns (IPriceOracle.Price memory) {
        uint256 base = _flatBase(name, duration);
        uint256 bps = _discountFor(duration);
        return IPriceOracle.Price({
            base: base - (base * bps) / 10_000,
            premium: 0
        });
    }

    /// @dev Flat per-length base, identical shape to RisePriceOracle.price.
    function _flatBase(string calldata name, uint256 duration) internal view returns (uint256) {
        uint256 len = name.strlen();
        uint256 index = len > 5 ? 4 : (len == 0 ? 0 : len - 1);
        return rentPrices[index] * duration;
    }

    /// @dev Discount bps for a duration, keyed by whole-year count. < 1 year => 0
    ///      (28-day base path stays discount-free). >= 10 years => the 10yr tier
    ///      (the oracle does not clamp; the controller enforces the 10yr cap).
    function _discountFor(uint256 duration) internal view returns (uint256) {
        uint256 years_ = duration / SECONDS_PER_YEAR; // floor whole years
        if (years_ == 0) return 0;
        if (years_ >= 10) return discountBps[10];
        return discountBps[years_];
    }

    /// @notice Owner-only bulk update of the per-length base schedule.
    function setRentPrices(uint256[5] calldata prices) external onlyOwner {
        rentPrices = prices;
        emit RentPriceChanged(prices);
    }

    /// @notice Read the per-length rent rate (1-5+).
    function rentPrice(uint256 length) external view returns (uint256) {
        uint256 index = length > 5 ? 4 : (length == 0 ? 0 : length - 1);
        return rentPrices[index];
    }

    /// @notice Owner-only bulk update of the discount tiers. Every entry must be
    ///         <= MAX_DISCOUNT_BPS (D-07 immutable cap). Emits the full snapshot
    ///         for off-chain monitoring (economic-threat mitigation).
    /// @param newDiscounts The 11-entry per-year discount table (index 0 unused).
    function setDiscounts(uint16[11] calldata newDiscounts) external onlyOwner {
        for (uint256 i; i < 11; ++i) {
            if (newDiscounts[i] > MAX_DISCOUNT_BPS) revert DiscountTooHigh(newDiscounts[i]);
        }
        discountBps = newDiscounts;
        emit DiscountsChanged(newDiscounts);
    }

    /// @notice ERC-165 advertisement of IERC165 || IPriceOracle.
    function supportsInterface(bytes4 interfaceID) public view virtual returns (bool) {
        return
            interfaceID == type(IERC165).interfaceId ||
            interfaceID == type(IPriceOracle).interfaceId;
    }
}

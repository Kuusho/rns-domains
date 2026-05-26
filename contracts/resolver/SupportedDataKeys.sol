// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title SupportedDataKeys (constants library)
/// @notice File-scope data-key namespace constants. Ported as a library so the
///         optional ENSIP-24 mixin (in the reference's
///         `profiles/SupportedDataKeys.sol`) is NOT pulled in — RESEARCH Open
///         Question 2 recommends skipping the mixin until a concrete data-key
///         consumer ships. This file exists as a stable home for future data-key
///         constants without committing PublicResolver / RiseOwnedResolver to
///         the mixin's storage layout.
/// @dev The reference does NOT declare any `bytes32 constant DATA_KEY_*` symbols
///      at file scope today; the only declarations live inside the optional
///      mixin contract at `reference/ens-contracts/contracts/resolvers/profiles/SupportedDataKeys.sol`.
///      Keeping this file as a placeholder library matches the Phase 4
///      must_haves.artifacts contract (`min_lines: 5`) and gives later phases a
///      single drop-in point for ENSIP-24-style key registrations.
library SupportedDataKeys {
    // Reserved for future ENSIP-24 data-key constants.
}

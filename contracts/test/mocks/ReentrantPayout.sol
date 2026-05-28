//SPDX-License-Identifier: MIT
pragma solidity >=0.8.17 <0.9.0;

/// @dev Minimal local view of the SubdomainRegistrar sale entrypoint the attacker
///      re-enters. Declared locally (no import) so the mock stays decoupled.
interface ISub {
    function register(bytes32 parentNode, string calldata label, address to)
        external
        payable
        returns (bytes32);
}

/// @title ReentrantPayout — reentrancy attacker for the SubdomainRegistrar (D-06 / T-7-01).
/// @notice Configured as the parent `payout` (or protocol `feeRecipient`, or the
///         buyer) so the sale's push transfer lands on its `receive()`. On the
///         first incoming value during a guarded `register`, it re-enters
///         `SubdomainRegistrar.register(...)` for the SAME subnode. Because the
///         outer `register` is `nonReentrant`, the re-entry hits the guard and
///         reverts with "ReentrancyGuard: reentrant call". The `attacking` flag
///         bounds it to a single re-entry.
/// @dev Two re-entry modes:
///      - `bubbleOnReenter = true` (default): let the inner revert bubble. The
///        registrar's `safeTransferETH` sees the failed push and reverts the
///        whole sale with its own `ETHTransferFailed()` — the attack still fails.
///      - `bubbleOnReenter = false` (capture mode): `try/catch` the inner
///        re-entry, store the inner revert reason in `lastRevertReason`, and
///        accept the funds so the outer sale settles. A test can then assert the
///        captured reason equals "ReentrancyGuard: reentrant call", proving the
///        guard SPECIFICALLY blocked the re-entry (not a generic revert).
contract ReentrantPayout {
    address public target;
    bytes32 public parentNode;
    string public label;
    bool public attacking;
    bool public bubbleOnReenter = true;
    bytes public lastRevertReason;

    /// @notice Arm the attacker with the registrar to re-enter and the subnode
    ///         to re-register on the next received transfer.
    function setTarget(address _target, bytes32 _parentNode, string calldata _label) external {
        target = _target;
        parentNode = _parentNode;
        label = _label;
        attacking = true;
    }

    /// @notice Toggle bubble (revert the whole sale) vs capture (record the inner
    ///         revert reason and let the outer sale settle).
    function setBubble(bool _bubble) external {
        bubbleOnReenter = _bubble;
    }

    /// @dev On the sale's push transfer, re-enter the registrar once.
    receive() external payable {
        if (!attacking) return;
        attacking = false;
        if (bubbleOnReenter) {
            // Let the reentrancy revert bubble — the registrar's push fails and
            // the whole sale reverts (ETHTransferFailed at the outer boundary).
            ISub(target).register(parentNode, label, address(this));
        } else {
            // Capture the inner revert reason; accept the funds so the legitimate
            // outer sale completes. Proves the guard fired without masking it.
            try ISub(target).register(parentNode, label, address(this)) returns (bytes32) {
                lastRevertReason = bytes("RE-ENTRY-SUCCEEDED");
            } catch (bytes memory reason) {
                lastRevertReason = reason;
            }
        }
    }
}

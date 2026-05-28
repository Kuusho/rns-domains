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
///         outer `register` is `nonReentrant`, the re-entry MUST revert with
///         "ReentrancyGuard: reentrant call", bubbling up and reverting the
///         whole sale. The `attacking` flag bounds it to a single re-entry.
contract ReentrantPayout {
    address public target;
    bytes32 public parentNode;
    string public label;
    bool public attacking;

    /// @notice Arm the attacker with the registrar to re-enter and the subnode
    ///         to re-register on the next received transfer.
    function setTarget(address _target, bytes32 _parentNode, string calldata _label) external {
        target = _target;
        parentNode = _parentNode;
        label = _label;
        attacking = true;
    }

    /// @dev On the sale's push transfer, re-enter the registrar once. The inner
    ///      call hits the `nonReentrant` guard and reverts; letting it bubble
    ///      reverts the outer `register` with "ReentrancyGuard: reentrant call".
    receive() external payable {
        if (attacking) {
            attacking = false;
            ISub(target).register(parentNode, label, address(this));
        }
    }
}

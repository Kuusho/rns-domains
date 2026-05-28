// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title ISubdomainRegistrar — external surface of the RNS subdomain marketplace.
/// @notice The events, custom errors, and external function surface of the
///         purely-additive Phase-7 `SubdomainRegistrar`. A `.rise` 2LD owner
///         lists their name for subdomain sales (`configure`); anyone may buy a
///         subdomain by paying the set price (`register`); sale revenue is split
///         parent-payout / protocol-fee with zero funds pooled in the contract.
/// @dev Custom errors are used here (this is a net-new contract; precedent:
///      Phase-6 `RiseRegistrarController` / `SignatureUtils`). The bare-require
///      posture applies only to the frozen registry/registrar.
///
///      The `configure` surface carries `parentLabelHash` (the 2LD's labelhash ==
///      the `RiseRegistrar` ERC-721 token id) because on-chain namehash inversion
///      is impossible — the registrar cannot recover the labelhash from the
///      `parentNode` namehash, so the caller MUST supply it. The registrar stores
///      it in `Config` and derives parent expiry exclusively via
///      `registrar.nameExpires(uint256(config.parentLabelHash))`.
interface ISubdomainRegistrar {
    /* ------------------------------------------------------------------ */
    /*                              Events                                 */
    /* ------------------------------------------------------------------ */

    /// @notice Emitted when a parent owner lists (or re-lists) a name for sales.
    /// @param parentNode The 2LD namehash being listed.
    /// @param controller The parent owner snapshot at configure (StaleController baseline).
    /// @param parentLabelHash The 2LD labelhash == RiseRegistrar token id (caller-supplied).
    /// @param payout The address that receives the parent share of each sale.
    /// @param price The per-subdomain price in native RISE wei (0 allowed).
    /// @param enabled Whether the listing is active.
    /// @param gateToken Optional ERC-20/ERC-721 gate token (0 = no gate).
    /// @param minGateBalance Minimum gate-token balance required of the buyer.
    event SubdomainConfigured(bytes32 indexed parentNode, address indexed controller, bytes32 parentLabelHash, address payout, uint256 price, bool enabled, address gateToken, uint256 minGateBalance);

    /// @notice Emitted when a parent owner disables an existing listing.
    /// @param parentNode The 2LD namehash whose listing was disabled.
    event SubdomainDisabled(bytes32 indexed parentNode);

    /// @notice Emitted when a subdomain is sold and minted to the buyer.
    /// @param parentNode The 2LD namehash the subdomain was sold under.
    /// @param subnode The full subnode namehash that was minted.
    /// @param payer The address that paid for the subdomain.
    /// @param to The address the subdomain was minted to.
    /// @param price The price paid (native RISE wei).
    /// @param fee The protocol fee taken from the price.
    /// @param label The human-readable subdomain label.
    event SubdomainRegistered(
        bytes32 indexed parentNode,
        bytes32 indexed subnode,
        address indexed payer,
        address to,
        uint256 price,
        uint256 fee,
        string label
    );

    /// @notice Emitted when a parent owner revokes a sold subdomain.
    /// @param parentNode The 2LD namehash the subdomain belonged to.
    /// @param labelHash The labelhash of the revoked subdomain.
    /// @param newOwner The address the subnode ownership was handed to (may be 0).
    event SubdomainRevoked(
        bytes32 indexed parentNode,
        bytes32 indexed labelHash,
        address newOwner
    );

    /// @notice Emitted when the protocol owner changes the fee rate.
    /// @param newBps The new fee rate in basis points (<= FEE_CAP_BPS).
    event FeeBpsChanged(uint256 newBps);

    /// @notice Emitted when the protocol owner changes the fee recipient.
    /// @param newRecipient The new protocol-fee recipient address.
    event FeeRecipientChanged(address newRecipient);

    /* ------------------------------------------------------------------ */
    /*                          Custom errors                             */
    /* ------------------------------------------------------------------ */

    /// @notice The caller is not the current owner of the parent node.
    error NotParentOwner();
    /// @notice The supplied `parentLabelHash` does not hash, with the `.rise`
    ///         node, to the supplied `parentNode` (forward-namehash mismatch).
    error ParentLabelMismatch();
    /// @notice The target subnode has no prior marketplace sale record to revoke.
    error NotSold();
    /// @notice The parent owner has not granted the registrar operator approval.
    error NotApproved();
    /// @notice The parent's listing is disabled.
    error NotEnabled();
    /// @notice An active subdomain already occupies the target subnode.
    error NotAvailable();
    /// @notice The parent's registration has changed since configure (transfer / re-registration).
    error StaleController();
    /// @notice The buyer does not hold the required gate-token balance.
    error GateFailed();
    /// @notice The supplied value is below the listed price.
    error InsufficientFee();
    /// @notice The requested fee rate exceeds the immutable hard cap.
    error FeeTooHigh();
    /// @notice A price or minGateBalance exceeds `type(uint96).max`.
    error ValueTooLarge();
    /// @notice gateToken / minGateBalance are not both-set-or-both-unset.
    error InvalidGateConfig();
    /// @notice The supplied label is empty.
    error EmptyLabel();
    /// @notice A push ETH transfer failed.
    error ETHTransferFailed();

    /* ------------------------------------------------------------------ */
    /*                       External functions                           */
    /* ------------------------------------------------------------------ */

    /// @notice Lists (or re-lists) a `.rise` 2LD for subdomain sales.
    /// @dev The 7-param form is LOCKED. The caller supplies `parentLabelHash`
    ///      (their own 2LD labelhash == RiseRegistrar token id) because on-chain
    ///      namehash inversion is impossible; the registrar stores it and uses it
    ///      for every `nameExpires` read.
    function configure(bytes32 parentNode, bytes32 parentLabelHash, address payout, uint256 price, bool enabled, address gateToken, uint256 minGateBalance) external;

    /// @notice Disables a parent's listing (no new sales).
    function disable(bytes32 parentNode) external;

    /// @notice Buys a subdomain under a listed parent, minting it to `to`.
    function register(bytes32 parentNode, string calldata label, address to)
        external
        payable
        returns (bytes32 subnode);

    /// @notice Buys a subdomain under a listed parent, minting it to `msg.sender`.
    function register(bytes32 parentNode, string calldata label)
        external
        payable
        returns (bytes32 subnode);

    /// @notice Parent-owner revocation of a sold subdomain.
    function revokeSubdomain(
        bytes32 parentNode,
        bytes32 labelHash,
        address newOwner
    ) external;

    /// @notice Protocol-owner setter for the fee rate (<= FEE_CAP_BPS).
    function setFeeBps(uint256 newBps) external;

    /// @notice Protocol-owner setter for the fee recipient.
    function setFeeRecipient(address newRecipient) external;

    /// @notice Whether a sold subdomain is still logically active (lazy epoch).
    function isActive(bytes32 parentNode, bytes32 labelHash)
        external
        view
        returns (bool);

    /// @notice Whether the target subnode is available to sell.
    function isSubnodeAvailable(bytes32 parentNode, bytes32 labelHash)
        external
        view
        returns (bool);
}

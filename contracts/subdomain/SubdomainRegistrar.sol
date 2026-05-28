// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {RNS} from "../registry/RNS.sol";
import {RiseRegistrar} from "../riseregistrar/RiseRegistrar.sol";
import {StringUtils} from "../utils/StringUtils.sol";
import {ISubdomainRegistrar} from "./ISubdomainRegistrar.sol";

/// @title SubdomainRegistrar — the RNS subdomain marketplace (Phase 7, v1.1).
/// @notice The ONE net-new, purely-additive contract for the subdomain
///         marketplace. A `.rise` 2LD owner lists their name for subdomain sales
///         (`configure`); anyone may buy a subdomain by paying the set price
///         (`register`); sale revenue is split parent-payout / protocol-fee with
///         ZERO funds pooled in the contract (instant push split). Sales may be
///         gated to holders of an ERC-20 or ERC-721 token. Previously-sold
///         subdomains lazily read inactive once the parent is transferred or
///         re-registered (epoch tuple), with no per-name counter.
/// @dev Economic patterns ported from the audited `wei-names` SubdomainRegistrar.
///      RNS-specific divergences (locked decisions):
///      - D-11 / SUB-07: NEVER takes custody — writes subnodes only through the
///        operator-approval path (`RNS.setSubnodeRecord`); never moves the parent
///        ERC-721, holds no token, has no escrow / parent-withdrawal surface.
///      - D-06 / SUB-03: pure push split, no pull ledger and no pooled-balance
///        bookkeeping.
///      - D-04: native RISE only — no ERC-20 payment path.
///      - Flag 2: storage-based OZ v4.9.3 `ReentrancyGuard` (transient-storage
///        guards would not compile under `evmVersion: paris`).
///      - Pitfall 2: control flow reads `RNS.owner` (never reverts), never the
///        registrar's expiry-masking owner getter (which reverts bare on expired
///        tokens). Epoch reads use the plain `nameExpires` getter only.
contract SubdomainRegistrar is ISubdomainRegistrar, Ownable, ReentrancyGuard {
    using StringUtils for *;

    /// @notice Per-parent listing configuration, keyed by the 2LD namehash.
    struct Config {
        address controller;        // parent owner snapshot at configure() — StaleController baseline (D-03)
        bytes32 parentLabelHash;   // 2LD labelhash == RiseRegistrar token id; caller-supplied at configure (namehash inversion is impossible) — Flag 1
        address payout;            // receives the parent share (D-01/D-06)
        uint96  price;             // native RISE wei (D-04); 0 allowed (D-05)
        bool    enabled;           // listing on/off (SUB-01 / disable())
        address gateToken;         // optional ERC-20/721 gate (D-09/D-10); 0 = no gate
        uint96  minGateBalance;    // required balance (>0 iff gateToken set)
        uint256 configEpoch;       // RiseRegistrar.nameExpires(parentId) at configure() — epoch baseline (Flag 1)
    }

    /// @notice Per-subnode sale record, used for lazy epoch invalidation.
    struct SubRecord {
        address buyer;                 // 0 = never sold / revoked
        address parentOwnerSnapshot;   // RNS.owner(parentNode) at sale (Flag 1)
        uint256 parentExpirySnapshot;  // RiseRegistrar.nameExpires(parentId) at sale (Flag 1)
    }

    RNS public immutable rns;
    RiseRegistrar public immutable registrar;
    address public immutable defaultResolver;
    /// @notice The `.rise` TLD node (`namehash('rise')`), read once from the
    ///         registrar at construction. SINGLE SOURCE OF TRUTH for the
    ///         forward-namehash check that binds a `parentLabelHash` to its
    ///         `parentNode` (CR-01) — no hardcoded namehash, no extra ctor arg.
    bytes32 public immutable riseNode;
    uint256 public constant  FEE_CAP_BPS = 1000;   // D-08 hard cap 10% (immutable cap, D-07)

    address public feeRecipient;   // owner-settable (D-07)
    uint256 public feeBps;         // owner-settable, <= FEE_CAP_BPS; default 0 (D-08)

    mapping(bytes32 => Config) public config;                            // parentNode => Config
    mapping(bytes32 => mapping(bytes32 => SubRecord)) public subRecords; // parentNode => labelHash => SubRecord

    /// @notice Deploys the registrar.
    /// @dev `FEE_CAP_BPS` is a contract CONSTANT, NOT a constructor arg (D-07/D-08).
    ///      OZ Ownable v4.9.3 seats `msg.sender` (the deployer); the deploy script
    ///      transfers ownership to the protocol `owner`.
    /// @param _rns The frozen RNS registry (subnode write path + auth primitive).
    /// @param _registrar The frozen RiseRegistrar (observable parent state for epochs).
    /// @param _defaultResolver The resolver written onto sold subnodes.
    /// @param _feeRecipient The initial protocol-fee recipient.
    /// @param _feeBps The initial protocol-fee rate in bps (<= FEE_CAP_BPS).
    constructor(
        RNS _rns,
        RiseRegistrar _registrar,
        address _defaultResolver,
        address _feeRecipient,
        uint256 _feeBps
    ) {
        if (_feeBps > FEE_CAP_BPS) revert FeeTooHigh();
        rns = _rns;
        registrar = _registrar;
        defaultResolver = _defaultResolver;
        // CR-01: source the `.rise` node from the registrar's own `baseNode`
        // (== namehash('rise')) so the forward-namehash binding shares the SAME
        // node the registrar derives subnode ownership from. No hardcoded hash.
        riseNode = _registrar.baseNode();
        feeRecipient = _feeRecipient;
        feeBps = _feeBps;
    }

    /* ------------------------------------------------------------------ */
    /*                          Parent owner API                          */
    /* ------------------------------------------------------------------ */

    /// @inheritdoc ISubdomainRegistrar
    /// @dev The 7-param form is LOCKED. `parentLabelHash` is the caller's own 2LD
    ///      labelhash (== RiseRegistrar token id); it is REQUIRED because on-chain
    ///      namehash inversion is impossible, and it drives every `nameExpires`
    ///      read for this listing. The up-front `isApprovedForAll` check (Pitfall 4)
    ///      surfaces a missing approval here, not at the buyer's `register`.
    function configure(bytes32 parentNode, bytes32 parentLabelHash, address payout, uint256 price, bool enabled, address gateToken, uint256 minGateBalance) external {
        if (_controllerOf(parentNode) != msg.sender) revert NotParentOwner();
        if (!rns.isApprovedForAll(msg.sender, address(this))) revert NotApproved();
        // CR-01: bind the caller-supplied 2LD labelhash to `parentNode` via the
        // forward namehash (inversion is impossible, but recomputation is not).
        // This restores the SUB-05 expiry tuple to the REAL parent name — every
        // `nameExpires(uint256(parentLabelHash))` read is now provably on-node.
        if (keccak256(abi.encodePacked(riseNode, parentLabelHash)) != parentNode) revert ParentLabelMismatch();
        if (price > type(uint96).max || minGateBalance > type(uint96).max) revert ValueTooLarge();
        // gate-config sanity: both-or-neither
        if ((gateToken == address(0)) != (minGateBalance == 0)) revert InvalidGateConfig();

        uint256 epoch = registrar.nameExpires(uint256(parentLabelHash));
        config[parentNode] = Config({
            controller: msg.sender,
            parentLabelHash: parentLabelHash,
            payout: payout,
            price: uint96(price),
            enabled: enabled,
            gateToken: gateToken,
            minGateBalance: uint96(minGateBalance),
            configEpoch: epoch
        });
        emit SubdomainConfigured(parentNode, msg.sender, parentLabelHash, payout, price, enabled, gateToken, minGateBalance);
    }

    /// @inheritdoc ISubdomainRegistrar
    function disable(bytes32 parentNode) external {
        if (_controllerOf(parentNode) != msg.sender) revert NotParentOwner();
        config[parentNode].enabled = false;
        emit SubdomainDisabled(parentNode);
    }

    /* ------------------------------------------------------------------ */
    /*                             Sale API                               */
    /* ------------------------------------------------------------------ */

    /// @inheritdoc ISubdomainRegistrar
    /// @dev Strict checks-effects-interactions, evaluated against the real
    ///      caller via the shared internal `_register` (no external self-call).
    ///      The `nonReentrant` guard lives on this public payable entry point.
    function register(bytes32 parentNode, string calldata label, address to) external payable nonReentrant returns (bytes32 subnode) {
        return _register(parentNode, label, to, msg.sender);
    }

    /// @inheritdoc ISubdomainRegistrar
    /// @dev Convenience overload minting to the caller. WR-01: routes through the
    ///      SAME internal `_register` with `payer = to = msg.sender` — NO external
    ///      `this.register{value:...}` self-call (which would rebind `msg.sender`
    ///      to the registrar, mis-gating the buyer and refunding the contract).
    ///      The `nonReentrant` guard lives on this public payable entry point.
    function register(bytes32 parentNode, string calldata label)
        external
        payable
        nonReentrant
        returns (bytes32 subnode)
    {
        return _register(parentNode, label, msg.sender, msg.sender);
    }

    /// @dev Shared sale body for both public `register` overloads. The gate is
    ///      checked against `payer` and the refund is pushed to `payer`, so the
    ///      principal is always the real caller (WR-01). NOT `nonReentrant` itself
    ///      (its two public callers carry the single OZ guard); strict CEI — all
    ///      state writes + the registry `setSubnodeRecord` happen BEFORE the three
    ///      independent push transfers (fee -> parent -> refund).
    function _register(bytes32 parentNode, string calldata label, address to, address payer) internal returns (bytes32 subnode) {
        Config memory c = config[parentNode];
        if (!c.enabled) revert NotEnabled();
        if (bytes(label).length == 0) revert EmptyLabel();            // single-level/non-empty (looser than 2LD)
        bytes32 labelHash = keccak256(bytes(label));
        if (!isSubnodeAvailable(parentNode, labelHash)) revert NotAvailable();   // SUB-06 guard
        subnode = keccak256(abi.encodePacked(parentNode, labelHash));

        // ---- CHECKS + EFFECTS (snapshots scoped so they die before settle, to
        //      keep the live-variable count under the paris stack limit) ----
        {
            address parentOwner = rns.owner(parentNode);
            uint256 curExpiry = registrar.nameExpires(uint256(c.parentLabelHash));
            if (parentOwner != c.controller) revert StaleController();    // D-03 StaleController
            if (curExpiry < c.configEpoch) revert StaleController();      // baseline floor

            if (c.gateToken != address(0)) {                              // D-09/D-10 gate against the payer
                if (_balanceOf(c.gateToken, payer) < uint256(c.minGateBalance)) revert GateFailed();
            }
            if (msg.value < uint256(c.price)) revert InsufficientFee();   // D-04 native; D-05 price may be 0

            // ---- EFFECTS (all state writes BEFORE any external value transfer) ----
            subRecords[parentNode][labelHash] = SubRecord({
                buyer: to,
                parentOwnerSnapshot: parentOwner,
                parentExpirySnapshot: curExpiry
            });
        }

        uint256 fee = c.price == 0 ? 0 : (uint256(c.price) * feeBps) / 10_000;   // feeBps <= FEE_CAP_BPS
        rns.setSubnodeRecord(parentNode, labelHash, to, defaultResolver, 0);   // operator-approval path (D-11/A3)
        emit SubdomainRegistered(parentNode, subnode, payer, to, uint256(c.price), fee, label);

        // ---- INTERACTIONS (independent; fee -> parent -> refund-to-payer) ----
        _settle(c.payout, fee, uint256(c.price), payer);
    }

    /// @dev INTERACTIONS step of a sale, split out to keep `_register`'s
    ///      live-variable count under the stack limit. Pushes the three
    ///      independent transfers in fixed order (fee -> parent -> refund-to-payer);
    ///      the public caller is `nonReentrant` and has already written all state,
    ///      so this is reached strictly after EFFECTS.
    function _settle(address payout, uint256 fee, uint256 price, address payer) private {
        if (fee != 0)               safeTransferETH(feeRecipient, fee);
        if (price - fee != 0)       safeTransferETH(payout, price - fee);
        if (msg.value - price != 0) safeTransferETH(payer, msg.value - price);
    }

    /// @inheritdoc ISubdomainRegistrar
    /// @dev Open-Q2 resolution: the parent owner chooses `newOwner` and the
    ///      SubRecord is cleared so `isSubnodeAvailable` returns true (re-sellable).
    function revokeSubdomain(
        bytes32 parentNode,
        bytes32 labelHash,
        address newOwner
    ) external {
        if (_controllerOf(parentNode) != msg.sender) revert NotParentOwner();
        // WR-02: only revoke subnodes that this marketplace actually sold. Without
        // this guard `revokeSubdomain` doubles as a general-purpose subnode writer
        // (the parent has granted operator approval) and can emit a misleading
        // `SubdomainRevoked` for a subnode that was never registered here.
        if (subRecords[parentNode][labelHash].buyer == address(0)) revert NotSold();
        delete subRecords[parentNode][labelHash];                    // clears so isSubnodeAvailable == true (re-sellable)
        rns.setSubnodeOwner(parentNode, labelHash, newOwner);        // hand back to parent owner or address(0)
        emit SubdomainRevoked(parentNode, labelHash, newOwner);
    }

    /* ------------------------------------------------------------------ */
    /*                         Protocol owner API                         */
    /* ------------------------------------------------------------------ */

    /// @inheritdoc ISubdomainRegistrar
    function setFeeBps(uint256 newBps) external onlyOwner {
        if (newBps > FEE_CAP_BPS) revert FeeTooHigh();
        feeBps = newBps;
        emit FeeBpsChanged(newBps);
    }

    /// @inheritdoc ISubdomainRegistrar
    function setFeeRecipient(address newRecipient) external onlyOwner {
        feeRecipient = newRecipient;
        emit FeeRecipientChanged(newRecipient);
    }

    /* ------------------------------------------------------------------ */
    /*                               Views                                */
    /* ------------------------------------------------------------------ */

    /// @inheritdoc ISubdomainRegistrar
    /// @dev Lazy epoch tuple (Flag 1): a sold subdomain is active iff it was sold,
    ///      the parent's registry owner still matches the sale-time snapshot, and
    ///      the parent's current `nameExpires` is still >= the sale-time snapshot.
    ///      A renewal (expiry increases, owner unchanged) survives; a transfer to
    ///      a new owner OR an expire->re-register (owner changes) reads inactive.
    ///      A1 NOTE: the rare "expired then re-registered by the EXACT same
    ///      address" edge keeps the prior subdomains alive — accepted-benign
    ///      (covered by VALIDATION.md manual row), economically equivalent to a
    ///      renewal of the owner's own lapsed name.
    function isActive(bytes32 parentNode, bytes32 labelHash) public view returns (bool) {
        SubRecord storage s = subRecords[parentNode][labelHash];
        if (s.buyer == address(0)) return false;                                  // never sold / revoked
        if (rns.owner(parentNode) != s.parentOwnerSnapshot) return false;         // re-registered to new owner (Flag 1)
        return registrar.nameExpires(uint256(config[parentNode].parentLabelHash)) >= s.parentExpirySnapshot; // renew survives; reset fails
    }

    /// @inheritdoc ISubdomainRegistrar
    /// @dev A2 NOTE: SUB-05 invalidation is LOGICAL — `isActive` reads false and
    ///      the subnode becomes re-sellable; the stale `RNS.owner(subnode)` record
    ///      is NOT physically erased (no on-chain enumeration to clear it).
    ///      Consumers and tests MUST assert on `isActive`, NEVER on
    ///      `rns.owner(subnode) == address(0)`.
    function isSubnodeAvailable(bytes32 parentNode, bytes32 labelHash) public view returns (bool) {
        bytes32 subnode = keccak256(abi.encodePacked(parentNode, labelHash));
        if (rns.owner(subnode) == address(0)) return true;                        // never created
        // created before — only re-sellable if our prior sale is now epoch-stale.
        // This inlines !isActive(...) (identical truth value) so the epoch read
        // is exercised directly on the availability path as well.
        SubRecord storage s = subRecords[parentNode][labelHash];
        if (s.buyer == address(0)) return true;                                   // record cleared by revoke -> re-sellable
        if (rns.owner(parentNode) != s.parentOwnerSnapshot) return true;          // parent re-registered -> stale -> re-sellable
        return registrar.nameExpires(uint256(config[parentNode].parentLabelHash)) < s.parentExpirySnapshot; // epoch reset -> re-sellable
    }

    /* ------------------------------------------------------------------ */
    /*                          Internal helpers                          */
    /* ------------------------------------------------------------------ */

    /// @dev Pitfall 2: read the controller from `RNS.owner` (never reverts and
    ///      persists past expiry), NEVER from `RiseRegistrar.ownerOf` (which
    ///      reverts bare for expired tokens).
    function _controllerOf(bytes32 parentNode) internal view returns (address) {
        return rns.owner(parentNode);
    }

    /// @dev Single internal-member push transfer. NOT a free function (so it can
    ///      reference the inherited `ETHTransferFailed` error) and NOT
    ///      `nonReentrant` (the guarded `register` already protects its call sites
    ///      — OZ single-guard limitation).
    function safeTransferETH(address to, uint256 value) internal {
        (bool ok, ) = to.call{value: value}("");
        if (!ok) revert ETHTransferFailed();
    }

    /// @dev Solady-style type-agnostic balance read (D-10): staticcalls
    ///      `balanceOf(address)` and returns 0 if the token does not implement it
    ///      (non-reverting). Works for ERC-20 AND ERC-721.
    function _balanceOf(address token, address account) internal view returns (uint256) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSelector(0x70a08231, account)); // balanceOf(address)
        if (ok && data.length >= 32) return abi.decode(data, (uint256));
        return 0;
    }
}

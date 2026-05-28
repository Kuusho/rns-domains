// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import {RiseRegistrar} from "../riseregistrar/RiseRegistrar.sol";
import {RNS} from "../registry/RNS.sol";
import {StringUtils} from "../utils/StringUtils.sol";
import {IReverseRegistrar} from "../reverseregistrar/IReverseRegistrar.sol";
import {IDefaultReverseRegistrar} from "../reverseregistrar/IDefaultReverseRegistrar.sol";
import {Multicallable} from "../resolver/Multicallable.sol";
import {IPriceOracle} from "./IPriceOracle.sol";
import {IRiseRegistrarController} from "./IRiseRegistrarController.sol";

/// @title RiseRegistrarController — public registration entry point.
/// @notice Ported from the ENS v1.7.0 registrar-controller reference (~408 LOC)
///         with the RNS-specific edits: `.eth` → `.rise` (TLD strings, TLD
///         namehash constant recomputed as `namehash('rise')` → `RISE_NODE`),
///         reference's base-registrar type → `RiseRegistrar`, `ENS` → `RNS`
///         (Phase 2 D-11 naming), reference's controller interface →
///         `IRiseRegistrarController`, reference's ethereum-reverse-record bit
///         constant → `REVERSE_RECORD_RISE_BIT`. Drops the reference's
///         optional token-recovery mixin (audit-noise inclusion not needed
///         for the MVP path). Adds RNS-only surface: reserved-name list
///         (REG-09 / REG-10), launch allowlist (REG-11 / REG-12), one-shot
///         `endLaunch()` (D-05), and `available()` length-rejection (REG-08).
/// @dev RISE_NODE is the pre-computed `namehash('rise')`; matches the value
///      passed to Phase 3's `deploy/riseregistrar/00_deploy_rise_registrar.ts`.
///      Solc 0.8.x cannot compute keccak256 at compile time so the constant
///      is baked in as a hex literal. Pitfall 4: the resolver write path
///      uses the node-checked multicall variant exclusively — plain
///      multicall would let a registration corrupt other names' records.
contract RiseRegistrarController is Ownable, IRiseRegistrarController, ERC165 {
    using StringUtils for *;

    /// @notice The bitmask for the Rise (addr.reverse) reverse record.
    /// @dev Renamed from the reference's ethereum-reverse-record bit constant
    ///      per RNS naming; bit position is unchanged (1).
    uint8 constant REVERSE_RECORD_RISE_BIT = 1;

    /// @notice The bitmask for the default (chain-agnostic) reverse record.
    uint8 constant REVERSE_RECORD_DEFAULT_BIT = 2;

    /// @notice The minimum duration for a registration.
    uint256 public constant MIN_REGISTRATION_DURATION = 28 days;

    /// @notice The maximum registration/renewal duration (MYR-01 / D-06): 10
    ///         years. Hard cap on the multi-year path; the 28-day floor
    ///         (MIN_REGISTRATION_DURATION) is unchanged.
    uint256 public constant MAX_REGISTRATION_DURATION = 10 * 365 days;

    /// @notice The node (i.e. namehash) for the `.rise` TLD.
    /// @dev Pre-computed `namehash('rise')`. Solidity 0.8.x cannot compute
    ///      keccak256 at compile time, so the constant is baked in as a hex
    ///      literal. The same value is passed to Phase 3's
    ///      `deploy/riseregistrar/00_deploy_rise_registrar.ts` via
    ///      `namehash('rise')` from viem.
    bytes32 private constant RISE_NODE =
        0x1c1625b450768b4e5ecaaff7c84ffb91aa8977dd9b07ee29a3f456fb6ec28f65;

    /// @notice The maximum expiry time for a registration.
    uint64 private constant MAX_EXPIRY = type(uint64).max;

    /// @notice The RNS registry.
    /// @dev Renamed from reference's `ens` per Phase 2 D-11 naming. Used to
    ///      write the new name's resolver slot before the multicall (REG-04).
    RNS public immutable rns;

    /// @notice The base registrar implementation for the `.rise` TLD.
    /// @dev Renamed from reference's `BaseRegistrarImplementation`.
    RiseRegistrar immutable base;

    /// @notice The minimum time a commitment must exist to be valid.
    uint256 public immutable minCommitmentAge;

    /// @notice The maximum time a commitment can exist to be valid.
    uint256 public immutable maxCommitmentAge;

    /// @notice The registrar for addr.reverse (coinType 60 equivalent).
    IReverseRegistrar public immutable reverseRegistrar;

    /// @notice The registrar for default.reverse (chain-agnostic fallback).
    IDefaultReverseRegistrar public immutable defaultReverseRegistrar;

    /// @notice The price oracle for the `.rise` TLD.
    IPriceOracle public immutable prices;

    /// @notice A mapping of commitments to their block.timestamp.
    mapping(bytes32 => uint256) public commitments;

    /// @notice Labels reserved by the owner — cannot be registered through
    ///         this controller. Keyed by `keccak256(bytes(label))` (labelHash,
    ///         NOT namehash). NEW vs reference — REG-09 / REG-10 / D-03.
    mapping(bytes32 => bool) public reserved;

    /// @notice Addresses authorised to register during the launch window. The
    ///         `register()` gate (REG-11) reverts `NotAllowlisted` when
    ///         `launchActive && !allowlisted[msg.sender]`. NEW vs reference —
    ///         REG-11 / REG-12 / D-04.
    mapping(address => bool) public allowlisted;

    /// @notice Whether the launch window is currently active. Initialised to
    ///         `true` in the constructor; flipped to `false` by the owner via
    ///         the one-shot `endLaunch()` toggle (D-05). NEW vs reference.
    bool public launchActive;

    /// @notice Cumulative native RISE paid through this controller for
    ///         registrations + renewals (protocol revenue). ENUM-02 / D-04 —
    ///         counts the PRICED amount (base+premium / base), NOT msg.value
    ///         (which includes the refunded excess — Pitfall 2). Subdomain
    ///         marketplace flows are NOT folded in (D-04).
    uint256 public cumulativeVolume;

    /// @notice Thrown when a commitment is not found.
    error CommitmentNotFound(bytes32 commitment);

    /// @notice Thrown when a commitment is too new.
    error CommitmentTooNew(
        bytes32 commitment,
        uint256 minimumCommitmentTimestamp,
        uint256 currentTimestamp
    );

    /// @notice Thrown when a commitment is too old.
    error CommitmentTooOld(
        bytes32 commitment,
        uint256 maximumCommitmentTimestamp,
        uint256 currentTimestamp
    );

    /// @notice Thrown when a name is not available to register.
    error NameNotAvailable(string name);

    /// @notice Thrown when the duration supplied for a registration is too short.
    error DurationTooShort(uint256 duration);

    /// @notice Thrown when the duration exceeds the 10-year cap. MYR-01 / D-06.
    error DurationTooLong(uint256 duration);

    /// @notice Thrown when data is supplied for a registration without a resolver.
    error ResolverRequiredWhenDataSupplied();

    /// @notice Thrown when a reverse record is requested without a resolver.
    error ResolverRequiredForReverseRecord();

    /// @notice Thrown when a matching unexpired commitment exists.
    error UnexpiredCommitmentExists(bytes32 commitment);

    /// @notice Thrown when the value sent for a registration is insufficient.
    error InsufficientValue();

    /// @notice Thrown when the maximum commitment age is too low.
    error MaxCommitmentAgeTooLow();

    /// @notice Thrown when the maximum commitment age is too high.
    error MaxCommitmentAgeTooHigh();

    /// @notice Thrown when the caller is not allowlisted during the launch
    ///         window. NEW vs reference — REG-11 gate.
    error NotAllowlisted(address caller);

    /// @notice Emitted when a name is registered.
    event NameRegistered(
        string label,
        bytes32 indexed labelhash,
        address indexed owner,
        uint256 baseCost,
        uint256 premium,
        uint256 expires,
        bytes32 referrer
    );

    /// @notice Emitted when a name is renewed.
    event NameRenewed(
        string label,
        bytes32 indexed labelhash,
        uint256 cost,
        uint256 expires,
        bytes32 referrer
    );

    /// @notice Emitted when a label's reserved status is toggled. NEW vs
    ///         reference — REG-10 surface.
    event ReservedChanged(bytes32 indexed labelHash, bool reserved);

    /// @notice Emitted when an address's allowlist status is toggled. NEW vs
    ///         reference — REG-12 surface.
    event AllowlistedChanged(address indexed account, bool enabled);

    /// @notice Emitted when the launch window ends. NEW vs reference — REG-12
    ///         / D-05 surface.
    event LaunchEnded(uint256 timestamp);

    /// @notice Constructor.
    /// @param _base The base registrar implementation for the `.rise` TLD.
    /// @param _prices The price oracle.
    /// @param _minCommitmentAge The minimum time a commitment must exist.
    /// @param _maxCommitmentAge The maximum time a commitment can exist.
    /// @param _reverseRegistrar The registrar for addr.reverse.
    /// @param _defaultReverseRegistrar The registrar for default.reverse.
    /// @param _rns The RNS registry.
    constructor(
        RiseRegistrar _base,
        IPriceOracle _prices,
        uint256 _minCommitmentAge,
        uint256 _maxCommitmentAge,
        IReverseRegistrar _reverseRegistrar,
        IDefaultReverseRegistrar _defaultReverseRegistrar,
        RNS _rns
    ) {
        if (_maxCommitmentAge <= _minCommitmentAge)
            revert MaxCommitmentAgeTooLow();

        if (_maxCommitmentAge > block.timestamp)
            revert MaxCommitmentAgeTooHigh();

        rns = _rns;
        base = _base;
        prices = _prices;
        minCommitmentAge = _minCommitmentAge;
        maxCommitmentAge = _maxCommitmentAge;
        reverseRegistrar = _reverseRegistrar;
        defaultReverseRegistrar = _defaultReverseRegistrar;

        // RNS D-05 — launch is active at construction; owner ends it via
        // endLaunch() when adoption signals are ready.
        launchActive = true;
    }

    /// @notice Returns the price of a registration for the given label and duration.
    function rentPrice(
        string calldata label,
        uint256 duration
    ) public view override returns (IPriceOracle.Price memory price) {
        bytes32 labelhash = keccak256(bytes(label));
        price = _rentPrice(label, labelhash, duration);
    }

    /// @notice Returns true if the label is valid for registration (rune-aware
    ///         length ≥ 3). REG-08.
    function valid(string calldata label) public pure returns (bool) {
        return label.strlen() >= 3;
    }

    /// @notice Returns true if the label is valid, not reserved, and
    ///         unregistered. REG-08 (length) + REG-09 (reserved) + base
    ///         registrar availability.
    function available(
        string calldata label
    ) public view override returns (bool) {
        bytes32 labelhash = keccak256(bytes(label));
        return _available(label, labelhash);
    }

    /// @notice Returns the commitment for a registration.
    function makeCommitment(
        Registration calldata registration
    ) public pure override returns (bytes32 commitment) {
        if (registration.data.length > 0 && registration.resolver == address(0))
            revert ResolverRequiredWhenDataSupplied();

        if (
            registration.reverseRecord != 0 &&
            registration.resolver == address(0)
        ) revert ResolverRequiredForReverseRecord();

        if (registration.duration < MIN_REGISTRATION_DURATION)
            revert DurationTooShort(registration.duration);

        // MYR-01 / D-06 — hard 10-year upper bound. Enforced here so BOTH the
        // makeCommitment pre-check and register (which re-derives the same
        // commitment) cover the register path; renew adds its own check.
        if (registration.duration > MAX_REGISTRATION_DURATION)
            revert DurationTooLong(registration.duration);

        return keccak256(abi.encode(registration));
    }

    /// @notice Commits a registration.
    function commit(bytes32 commitment) public override {
        if (commitments[commitment] + maxCommitmentAge >= block.timestamp) {
            revert UnexpiredCommitmentExists(commitment);
        }
        commitments[commitment] = block.timestamp;
    }

    /// @notice Registers a name.
    /// @dev REG-11 gate at top (cheapest check first — allowlist short-circuit
    ///      before pricing or commitment lookups). Pitfall 4: optional records
    ///      use the node-checked multicall variant only, never the plain
    ///      multicall variant. Pitfall 2: refund of excess payment is the
    ///      LAST statement after all state mutations and sub-calls.
    function register(
        Registration calldata registration
    ) public payable override {
        // REG-11 — allowlist gate during launch. Reverts immediately if the
        // caller is not on the allowlist while launchActive == true.
        if (launchActive && !allowlisted[msg.sender])
            revert NotAllowlisted(msg.sender);

        bytes32 labelhash = keccak256(bytes(registration.label));
        IPriceOracle.Price memory price = _rentPrice(
            registration.label,
            labelhash,
            registration.duration
        );
        uint256 totalPrice = price.base + price.premium;
        if (msg.value < totalPrice) revert InsufficientValue();

        if (!_available(registration.label, labelhash))
            revert NameNotAvailable(registration.label);

        bytes32 commitment = makeCommitment(registration);
        uint256 commitmentTimestamp = commitments[commitment];

        // Require an old enough commitment.
        if (commitmentTimestamp + minCommitmentAge > block.timestamp)
            revert CommitmentTooNew(
                commitment,
                commitmentTimestamp + minCommitmentAge,
                block.timestamp
            );

        // If the commitment is too old, or the name is registered, stop.
        if (commitmentTimestamp + maxCommitmentAge <= block.timestamp) {
            if (commitmentTimestamp == 0) revert CommitmentNotFound(commitment);
            revert CommitmentTooOld(
                commitment,
                commitmentTimestamp + maxCommitmentAge,
                block.timestamp
            );
        }

        delete (commitments[commitment]);

        uint256 expires;

        if (registration.resolver == address(0)) {
            expires = base.register(
                uint256(labelhash),
                registration.owner,
                registration.duration
            );
        } else {
            expires = base.register(
                uint256(labelhash),
                address(this),
                registration.duration
            );

            // RNS rename: the RNS TLD namehash constant + the rns storage
            // variable (reference used the ENS-named equivalents).
            bytes32 namehash = keccak256(
                abi.encodePacked(RISE_NODE, labelhash)
            );
            rns.setRecord(
                namehash,
                registration.owner,
                registration.resolver,
                0
            );

            // Pitfall 4 — the node-checked multicall variant binds every
            // inner call's namehash to this name, preventing cross-name
            // record corruption. The plain multicall variant would be a
            // security violation here.
            if (registration.data.length > 0)
                Multicallable(registration.resolver).multicallWithNodeCheck(
                    namehash,
                    registration.data
                );

            base.transferFrom(
                address(this),
                registration.owner,
                uint256(labelhash)
            );

            // RNS rename: the rise-reverse-record bit constant (the reference
            // used the chain-named equivalent). The reverse-record target is
            // msg.sender (Pitfall 7 — by design, the reverse record IS the
            // sender's, not the future owner's).
            if (registration.reverseRecord & REVERSE_RECORD_RISE_BIT != 0)
                reverseRegistrar.setNameForAddr(
                    msg.sender,
                    msg.sender,
                    registration.resolver,
                    string.concat(registration.label, ".rise")
                );
            if (registration.reverseRecord & REVERSE_RECORD_DEFAULT_BIT != 0)
                defaultReverseRegistrar.setNameForAddr(
                    msg.sender,
                    string.concat(registration.label, ".rise")
                );
        }

        emit NameRegistered(
            registration.label,
            labelhash,
            registration.owner,
            price.base,
            price.premium,
            expires,
            registration.referrer
        );

        // ENUM-02 / D-04 — accrue the PRICED amount (base+premium), NOT
        // msg.value (Pitfall 2). Pure storage write placed in the EFFECTS
        // region, BEFORE the refund-last external call (CEI preserved; no new
        // reentrancy surface introduced).
        cumulativeVolume += totalPrice;

        // Pitfall 2 — refund of excess payment is the LAST statement after
        // all state mutations and sub-calls (reentrancy posture preserved
        // from reference).
        if (msg.value > totalPrice)
            payable(msg.sender).transfer(msg.value - totalPrice);
    }

    /// @notice Renews a name.
    function renew(
        string calldata label,
        uint256 duration,
        bytes32 referrer
    ) external payable override {
        bytes32 labelhash = keccak256(bytes(label));

        // MYR-01 / D-06 — hard 10-year upper bound. renew does NOT go through
        // makeCommitment, so the cap is enforced here independently. NO lower
        // bound is added — renew has no MIN floor today and that is preserved.
        if (duration > MAX_REGISTRATION_DURATION) revert DurationTooLong(duration);

        IPriceOracle.Price memory price = _rentPrice(
            label,
            labelhash,
            duration
        );
        if (msg.value < price.base) revert InsufficientValue();

        uint256 expires = base.renew(uint256(labelhash), duration);

        emit NameRenewed(label, labelhash, price.base, expires, referrer);

        // ENUM-02 / D-04 — accrue the PRICED amount (price.base), NOT msg.value
        // (Pitfall 2). Storage write BEFORE the refund-last external call
        // (CEI preserved; mirrors register()).
        cumulativeVolume += price.base;

        // Pitfall 2 — refund last (mirrors register()).
        if (msg.value > price.base)
            payable(msg.sender).transfer(msg.value - price.base);
    }

    /// @notice Withdraws the balance of the contract to the owner.
    function withdraw() public {
        payable(owner()).transfer(address(this).balance);
    }

    /// @inheritdoc IERC165
    function supportsInterface(
        bytes4 interfaceID
    ) public view override(ERC165) returns (bool) {
        return
            interfaceID == type(IRiseRegistrarController).interfaceId ||
            super.supportsInterface(interfaceID);
    }

    /* RNS — Reserved + Allowlist + Launch surface */

    /// @notice Owner-only — adds or removes a label from the reserved list.
    /// @param labelHash The keccak256 of the label (NOT namehash; labelHash
    ///        matches the same id space the registrar uses for ERC-721 token
    ///        IDs).
    /// @param isReserved True to reserve, false to clear.
    function setReserved(bytes32 labelHash, bool isReserved) external onlyOwner {
        reserved[labelHash] = isReserved;
        emit ReservedChanged(labelHash, isReserved);
    }

    /// @notice Owner-only — adds or removes an address from the launch
    ///         allowlist.
    function setAllowlisted(address account, bool ok) external onlyOwner {
        allowlisted[account] = ok;
        emit AllowlistedChanged(account, ok);
    }

    /// @notice Owner-only one-shot — ends the launch window, opening
    ///         registration to all addresses.
    /// @dev `require(launchActive)` pre-guard makes accidental double-call
    ///      observable (auditor-expected posture per D-05). Allowlist storage
    ///      is NOT cleared (D-06) — kept as historical record.
    function endLaunch() external onlyOwner {
        require(launchActive, "Launch already ended");
        launchActive = false;
        emit LaunchEnded(block.timestamp);
    }

    /* Internal functions */

    function _rentPrice(
        string calldata label,
        bytes32 labelhash,
        uint256 duration
    ) internal view returns (IPriceOracle.Price memory price) {
        price = prices.price(
            label,
            base.nameExpires(uint256(labelhash)),
            duration
        );
    }

    function _available(
        string calldata label,
        bytes32 labelHash
    ) internal view returns (bool) {
        // Order: cheap-first short-circuit (RESEARCH Focus 2).
        return
            valid(label) &&
            !reserved[labelHash] &&
            base.available(uint256(labelHash));
    }
}

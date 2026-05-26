// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RNS} from "../registry/RNS.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Multicallable} from "./Multicallable.sol";
import {ABIResolver} from "./profiles/ABIResolver.sol";
import {AddrResolver} from "./profiles/AddrResolver.sol";
import {ContentHashResolver} from "./profiles/ContentHashResolver.sol";
import {DataResolver} from "./profiles/DataResolver.sol";
import {DNSResolver} from "./profiles/DNSResolver.sol";
import {InterfaceResolver} from "./profiles/InterfaceResolver.sol";
import {NameResolver} from "./profiles/NameResolver.sol";
import {PubkeyResolver} from "./profiles/PubkeyResolver.sol";
import {TextResolver} from "./profiles/TextResolver.sol";

/// @title PublicResolver
/// @notice A simple resolver anyone can use; only allows the owner of a node to
///         set its records. Aggregates Plan 04-01's `Multicallable` infrastructure
///         and Plan 04-02's 9 profile mixins behind a single concrete contract,
///         plus an OZ `Ownable` admin surface for rotating the two trusted-caller
///         slots after Phase 6 ships.
///
/// @dev Ported verbatim-in-intent from
///      reference/ens-contracts/contracts/resolvers/PublicResolver.sol with the
///      Phase 4 locked divergences applied:
///        * D-01: constructor is `(RNS, address trustedRiseController, address trustedReverseRegistrar)`
///                — NO `INameWrapper` slot. Both trusted-address slots accept
///                `address(0)` at Phase 4 deploy time and are wired post-Phase-6
///                via the owner-only setters `setTrustedController` and
///                `setTrustedReverseRegistrar`. The contract inherits OZ
///                `Ownable` so those setters can be `onlyOwner`-gated. The
///                constructor seats `msg.sender` (the deployer) as the OZ
///                owner; Plan 05's deploy script will call
///                `transferOwnership(owner)` post-deploy per Phase 3 D-14's
///                distinct-account pattern.
///        * D-04: this contract does NOT inherit `ExtendedResolver` — only
///                `RiseOwnedResolver` does (Plan 04-04).
///        * D-06: 2-tier authorisation — account-wide operator approvals
///                (`_operatorApprovals`, ERC-1155 `setApprovalForAll` shape) +
///                per-name delegate approvals (`_tokenApprovals`, ENSIP-32
///                `approve(node, delegate, bool)` shape). The `isAuthorised`
///                override is a 5-source check (no NameWrapper branch).
///        * D-07: `ReverseClaimer` is NOT inherited — RNS has no reverse
///                registrar yet (Phase 6); the resolver does not self-claim a
///                reverse name.
///        * D-11: pragma `^0.8.26`.
///        * D-12: `authorised(node)` modifier (inherited from ResolverBase) is
///                bare-revert; ported tests assert `.toBeRevertedWithoutReason()`.
///        * D-13: ERC-165 advertisement via the inherited multi-base
///                `supportsInterface` override; Ownable does NOT override
///                `supportsInterface` so it is excluded from the override list.
///
/// @dev Pitfall 7 — inheritance ORDER is load-bearing: `AddrResolver` MUST
///      precede `InterfaceResolver` because `InterfaceResolver` inherits
///      `AddrResolver` (the ERC-165 fallback path queries `addr(node)`). Solidity
///      c3-linearization requires the more-derived base to be listed after the
///      bases it itself inherits. The reference's order is preserved verbatim
///      with `ReverseClaimer` dropped and `Ownable` appended.
contract PublicResolver is
    Multicallable,
    ABIResolver,
    AddrResolver,
    ContentHashResolver,
    DataResolver,
    DNSResolver,
    InterfaceResolver,
    NameResolver,
    PubkeyResolver,
    TextResolver,
    Ownable
{
    /// @notice The RNS registry this resolver reads owner records from.
    /// @dev Storage variable named `rns` (not `ens`) per Phase 2 D-11 and
    ///      Phase 3 carry-forward. Declared `public` so ported tests (and any
    ///      downstream tooling) can read the slot via the auto-generated
    ///      `rns()` getter without a wrapper.
    RNS public immutable rns;

    /// @notice Trusted Phase 6 RiseRegistrarController address — bypasses
    ///         `authorised(node)`.
    /// @dev Defaults to `address(0)` at Phase 4 deploy time. Plan 05's deploy
    ///      script leaves it at `0`; Phase 6 wires it via `setTrustedController`.
    ///      While zero, the bypass branch (`msg.sender == address(0)`) is
    ///      unreachable for any real caller.
    address public trustedRiseController;

    /// @notice Trusted Phase 6 ReverseRegistrar address — bypasses
    ///         `authorised(node)`.
    /// @dev Same lifecycle as `trustedRiseController`.
    address public trustedReverseRegistrar;

    /// @notice Account-wide operator approvals (ERC-1155 `setApprovalForAll`
    ///         semantics). `_operatorApprovals[owner][operator] == true` means
    ///         `operator` may make any changes to records on every name
    ///         `owner` owns in the registry.
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    /// @notice Per-name delegate approvals (ENSIP-32 `approve(node, delegate,
    ///         approved)` semantics). `_tokenApprovals[owner][node][delegate]
    ///         == true` means `delegate` may make changes to records on the
    ///         specific `node` only.
    mapping(address => mapping(bytes32 => mapping(address => bool)))
        private _tokenApprovals;

    /// @notice Emitted when an operator approval is added or removed.
    event ApprovalForAll(
        address indexed owner,
        address indexed operator,
        bool approved
    );

    /// @notice Emitted when a per-name delegate approval is added or removed.
    event Approved(
        address owner,
        bytes32 indexed node,
        address indexed delegate,
        bool indexed approved
    );

    /// @notice Emitted when `trustedRiseController` is rotated by the owner.
    event TrustedControllerChanged(
        address indexed previous,
        address indexed next
    );

    /// @notice Emitted when `trustedReverseRegistrar` is rotated by the owner.
    event TrustedReverseRegistrarChanged(
        address indexed previous,
        address indexed next
    );

    /// @notice Deploys a PublicResolver bound to a given RNS registry and the
    ///         initial trusted-caller slots.
    /// @dev Per D-01, no `INameWrapper` slot. Both trusted slots accept
    ///      `address(0)` at Phase 4 deploy time; Plan 05's deploy script wires
    ///      them via `setTrustedController` / `setTrustedReverseRegistrar`
    ///      after Phase 6 contracts exist. The OZ `Ownable` constructor seats
    ///      `msg.sender` (the deployer) as the contract owner; the deploy
    ///      script must call `transferOwnership(owner)` to hand off to the
    ///      named `owner` account (Phase 3 D-14 distinct-account pattern).
    /// @param _rns The RNS registry the resolver reads owner records from.
    /// @param _trustedRiseController The Phase 6 controller address (or 0).
    /// @param _trustedReverseRegistrar The Phase 6 reverse-registrar address (or 0).
    constructor(
        RNS _rns,
        address _trustedRiseController,
        address _trustedReverseRegistrar
    ) {
        rns = _rns;
        trustedRiseController = _trustedRiseController;
        trustedReverseRegistrar = _trustedReverseRegistrar;
    }

    /// @notice Rotate the trusted RiseRegistrarController address.
    /// @dev `onlyOwner` per D-01. Non-owner callers revert with the exact OZ
    ///      v4 message `"Ownable: caller is not the owner"` — ported tests
    ///      assert this string.
    /// @param controller The new controller address (may be `address(0)` to
    ///        revoke).
    function setTrustedController(address controller) external onlyOwner {
        emit TrustedControllerChanged(trustedRiseController, controller);
        trustedRiseController = controller;
    }

    /// @notice Rotate the trusted ReverseRegistrar address.
    /// @dev `onlyOwner` per D-01.
    /// @param registrar The new reverse-registrar address (may be
    ///        `address(0)` to revoke).
    function setTrustedReverseRegistrar(address registrar) external onlyOwner {
        emit TrustedReverseRegistrarChanged(
            trustedReverseRegistrar,
            registrar
        );
        trustedReverseRegistrar = registrar;
    }

    /// @dev See {IERC1155-setApprovalForAll}.
    function setApprovalForAll(address operator, bool approved) external {
        require(
            msg.sender != operator,
            "ERC1155: setting approval status for self"
        );

        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    /// @dev See {IERC1155-isApprovedForAll}.
    function isApprovedForAll(
        address account,
        address operator
    ) public view returns (bool) {
        return _operatorApprovals[account][operator];
    }

    /// @notice Approve `delegate` to manage records on `node`.
    /// @dev Per-name approval (D-06 second tier). Self-approval is rejected.
    function approve(bytes32 node, address delegate, bool approved) external {
        require(msg.sender != delegate, "Setting delegate status for self");

        _tokenApprovals[msg.sender][node][delegate] = approved;
        emit Approved(msg.sender, node, delegate, approved);
    }

    /// @notice Check whether `delegate` may manage records on `node` on
    ///         behalf of `nodeOwner`.
    function isApprovedFor(
        address nodeOwner,
        bytes32 node,
        address delegate
    ) public view returns (bool) {
        return _tokenApprovals[nodeOwner][node][delegate];
    }

    /// @notice Authorisation override for the `authorised(node)` modifier.
    /// @dev Per D-06 the 5-source check is:
    ///        1) msg.sender == trustedRiseController (Phase 6 controller bypass)
    ///        2) msg.sender == trustedReverseRegistrar (Phase 6 reverse bypass)
    ///        3) msg.sender == rns.owner(node) (registry-recorded owner)
    ///        4) isApprovedForAll(nodeOwner, msg.sender) (account-wide operator)
    ///        5) isApprovedFor(nodeOwner, node, msg.sender) (per-name delegate)
    ///      The reference's NameWrapper branch (per D-01 / Phase 8 deferral)
    ///      is DELETED entirely — no commented-out version.
    ///      Local variable named `nodeOwner` (not `owner`) to avoid shadowing
    ///      OZ Ownable's `owner()` getter.
    function isAuthorised(bytes32 node) internal view override returns (bool) {
        if (
            msg.sender == trustedRiseController ||
            msg.sender == trustedReverseRegistrar
        ) {
            return true;
        }
        address nodeOwner = rns.owner(node);
        return
            nodeOwner == msg.sender ||
            isApprovedForAll(nodeOwner, msg.sender) ||
            isApprovedFor(nodeOwner, node, msg.sender);
    }

    /// @notice ERC-165 advertisement — unions the interfaceIds advertised by
    ///         every inherited mixin via the c3-linearized `super` chain.
    /// @dev Per Pitfall 7 the `override(...)` list MUST match the inheritance
    ///      list (sans `Ownable`, which does not override `supportsInterface`).
    function supportsInterface(
        bytes4 interfaceID
    )
        public
        view
        override(
            Multicallable,
            ABIResolver,
            AddrResolver,
            ContentHashResolver,
            DataResolver,
            DNSResolver,
            InterfaceResolver,
            NameResolver,
            PubkeyResolver,
            TextResolver
        )
        returns (bool)
    {
        return super.supportsInterface(interfaceID);
    }
}

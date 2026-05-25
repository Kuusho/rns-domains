// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RNS} from "../registry/RNS.sol";
import {IRiseRegistrar} from "./IRiseRegistrar.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title RiseRegistrar — the .rise TLD registrar.
/// @notice ERC-721 token contract where each registered `.rise` 2LD is a token
///         whose id is the labelhash of the label. Authorised controllers (set
///         through the `RegistrarSecurityController` break-glass owner) mint,
///         renew, and re-register expired names. ERC-721 ownership and
///         transfer semantics work as standard; the `ownerOf` override masks
///         expired names as un-owned, and the `_isApprovedOrOwner` override
///         routes through it so expired tokens cannot be transferred even by
///         their pre-expiry owner.
/// @dev Clean-room re-implementation of ENS's `BaseRegistrarImplementation`
///      (Phase 2 D-06, Phase 3 D-08 / D-10). The function signatures, event
///      topic layouts, and observable behavior (revert shapes, expiry math,
///      grace-period semantics, `_register` body order) are byte-for-byte
///      ENS-compatible and frozen by Phase 2 D-07.
///
///      Phase-3 divergences from the reference:
///      - Branded ERC-721 (D-05 / D-06): constructor calls the OZ ERC721
///        constructor with the RiseChain Name Service collection name and the
///        `.rise` symbol instead of the reference's empty pair. Wallets,
///        explorers, and marketplaces show the collection name and symbol.
///        The brand is hardcoded (D-06) — there is one `.rise` brand.
///      - Registry reference named `rns` not `ens` (Phase 2 D-11 naming).
///      - SPDX header + pragma 0.8.26 (Phase 2 D-09). Reference predates SPDX.
///
///      Inheritance order matches the reference (`ERC721, IRiseRegistrar,
///      Ownable`) — `Ownable` last so the c3-linearized `_msgSender()` resolves
///      to OZ's, and so the `supportsInterface` override path lines up.
contract RiseRegistrar is ERC721, IRiseRegistrar, Ownable {
    /// @dev Token id → expiry timestamp. Visibility intentionally default
    ///      (matches reference). The public surface goes through
    ///      `nameExpires(id)` so the field can stay private.
    mapping(uint256 => uint256) expiries;

    /// @notice The RNS registry this registrar talks into. Named `rns` not
    ///         `ens` per Phase 2 D-11 — the ported tests read `.read.rns()`.
    RNS public rns;

    /// @notice The namehash of the TLD this registrar owns
    ///         (`namehash('rise')`). Set in the constructor.
    bytes32 public baseNode;

    /// @notice Addresses currently authorised to call `register` / `renew`.
    ///         Mutated via `addController` / `removeController` (owner-only).
    mapping(address => bool) public controllers;

    /// @notice The grace period that follows a name's expiry. During this
    ///         window the previous owner can still renew (but cannot transfer
    ///         or reclaim) and the name is not yet available for re-registration.
    uint256 public constant GRACE_PERIOD = 90 days;

    /// @dev ERC-165 meta interface id — `bytes4(keccak256("supportsInterface(bytes4)"))`.
    bytes4 private constant INTERFACE_META_ID =
        bytes4(keccak256("supportsInterface(bytes4)"));

    /// @dev The ERC-721 interface id, derived as the XOR of the 9 ERC-721
    ///      selectors per the reference (matches the manual derivation pattern
    ///      Phase-3 Claude's Discretion calls out, so ported `supportsInterface`
    ///      tests pass unchanged).
    bytes4 private constant ERC721_ID =
        bytes4(
            keccak256("balanceOf(address)") ^
                keccak256("ownerOf(uint256)") ^
                keccak256("approve(address,uint256)") ^
                keccak256("getApproved(uint256)") ^
                keccak256("setApprovalForAll(address,bool)") ^
                keccak256("isApprovedForAll(address,address)") ^
                keccak256("transferFrom(address,address,uint256)") ^
                keccak256("safeTransferFrom(address,address,uint256)") ^
                keccak256("safeTransferFrom(address,address,uint256,bytes)")
        );

    /// @dev The `reclaim(uint256,address)` selector — separately advertised via
    ///      `supportsInterface` so consumers can probe for the reclaim surface.
    bytes4 private constant RECLAIM_ID =
        bytes4(keccak256("reclaim(uint256,address)"));

    /// @notice Constructs the registrar with the RNS registry it talks into and
    ///         the namehash of the TLD it owns.
    /// @dev Branded with the RiseChain Name Service collection name and the
    ///      `.rise` symbol per D-05/D-06 — diverges from the reference's empty
    ///      pair. Strings are hardcoded; there is one `.rise` brand and no
    ///      deploy-time variation.
    /// @param _rns The RNS registry the registrar reads/writes through.
    /// @param _baseNode The namehash of the TLD this registrar owns
    ///        (e.g. `namehash('rise')`).
    constructor(RNS _rns, bytes32 _baseNode)
        ERC721("RiseChain Name Service", ".rise")
    {
        rns = _rns;
        baseNode = _baseNode;
    }

    /// @dev Reverts (bare — no reason string) if the registry's record of
    ///      `baseNode` no longer points at this registrar. Lets the root
    ///      (`RNSRoot`) cleanly disable the registrar by reassigning `.rise`
    ///      away from it. The bare `require` is required by Phase-3 Claude's
    ///      Discretion / Pitfall 5 — porting tests assert
    ///      `.toBeRevertedWithoutReason()`.
    modifier live() {
        require(rns.owner(baseNode) == address(this));
        _;
    }

    /// @dev Restricts a function to addresses registered via `addController`.
    ///      Bare `require` — see `live` for the same Pitfall-5 reason.
    modifier onlyController() {
        require(controllers[msg.sender]);
        _;
    }

    /// @dev `_isApprovedOrOwner` override (carried over from the reference's
    ///      OZ v2.1.3 pattern): calls the UNQUALIFIED `ownerOf(tokenId)` so
    ///      vtable-dispatch lands on this contract's override of `ownerOf`,
    ///      which reverts for expired tokens. Without this override (Pitfall 6),
    ///      OZ v4's base `_isApprovedOrOwner` would call
    ///      `ERC721.ownerOf(tokenId)` (qualified) and bypass the expiry check —
    ///      letting an expired token be transferred by its pre-expiry owner.
    /// @param spender The address attempting to spend the token.
    /// @param tokenId The token id being queried.
    /// @return True if `spender` is the owner, approved for the token, or an
    ///         operator of the owner.
    function _isApprovedOrOwner(
        address spender,
        uint256 tokenId
    ) internal view override returns (bool) {
        address ownerAddr = ownerOf(tokenId);
        return (spender == ownerAddr ||
            getApproved(tokenId) == spender ||
            isApprovedForAll(ownerAddr, spender));
    }

    /// @notice Returns the current owner of the token, reverting (bare) for
    ///         expired tokens.
    /// @dev BARE `require` (Pitfall 5) — masking an expired token's owner is a
    ///      design choice, and the conformance suite asserts the revert has no
    ///      reason string.
    /// @param tokenId The token id to query.
    /// @return The owner of the unexpired token.
    function ownerOf(
        uint256 tokenId
    ) public view override(IERC721, ERC721) returns (address) {
        require(expiries[tokenId] > block.timestamp);
        return super.ownerOf(tokenId);
    }

    /// @notice Authorises `controller` to call `register` and `renew`.
    /// @dev Owner-only. In deployed RNS the owner is the
    ///      `RegistrarSecurityController` break-glass.
    /// @param controller The address to authorise.
    function addController(
        address controller
    ) external override onlyOwner {
        controllers[controller] = true;
        emit ControllerAdded(controller);
    }

    /// @notice Revokes `controller`'s permission to register and renew.
    /// @dev Owner-only.
    /// @param controller The address to revoke.
    function removeController(
        address controller
    ) external override onlyOwner {
        controllers[controller] = false;
        emit ControllerRemoved(controller);
    }

    /// @notice Sets the resolver for the TLD node this registrar owns.
    /// @dev Owner-only. Forwards into the registry; the registry's owner-check
    ///      passes because `RNSRoot.setSubnodeOwner(labelhash('rise'),
    ///      registrar)` ran during deploy.
    /// @param resolver The resolver address to assign to `baseNode`.
    function setResolver(
        address resolver
    ) external override onlyOwner {
        rns.setResolver(baseNode, resolver);
    }

    /// @notice Returns the expiry timestamp of the name with id `id`, or `0`
    ///         if it was never registered.
    /// @param id The labelhash of the label.
    function nameExpires(
        uint256 id
    ) external view override returns (uint256) {
        return expiries[id];
    }

    /// @notice Returns whether the name with id `id` is available for
    ///         registration. Strict `<` so the grace-period day-of-expiry
    ///         boundary is in-grace, not available.
    /// @param id The labelhash of the label.
    function available(uint256 id) public view override returns (bool) {
        return expiries[id] + GRACE_PERIOD < block.timestamp;
    }

    /// @notice Registers a name and mints the ERC-721 token, writing the
    ///         registry's record of the subnode as well.
    /// @param id The labelhash of the label to register.
    /// @param owner The address that will own the registration.
    /// @param duration Registration duration in seconds.
    /// @return The new expiry timestamp.
    function register(
        uint256 id,
        address owner,
        uint256 duration
    ) external override returns (uint256) {
        return _register(id, owner, duration, true);
    }

    /// @notice Registers a name and mints the ERC-721 token WITHOUT writing
    ///         the registry's record of the subnode. Used by upstream
    ///         controllers that want to set their own resolver/owner via a
    ///         multicall after registration. Not exposed on `IRiseRegistrar`
    ///         (matches reference posture).
    /// @param id The labelhash of the label to register.
    /// @param owner The address that will own the registration.
    /// @param duration Registration duration in seconds.
    /// @return The new expiry timestamp.
    function registerOnly(
        uint256 id,
        address owner,
        uint256 duration
    ) external returns (uint256) {
        return _register(id, owner, duration, false);
    }

    /// @dev Internal registration helper. The body-statement ORDER below is
    ///      load-bearing (Pitfall 7): expiry is written first so any `_exists`
    ///      branch's `_burn` runs against an expiry that lets `ownerOf` resolve
    ///      cleanly, and `_burn` precedes `_mint` so OZ v4's
    ///      "ERC721: token already minted" guard does not trip on re-register
    ///      of expired names.
    ///
    ///      The overflow `require` (Pitfall 8) looks vacuous in Solidity 0.8+
    ///      (the language would revert on the overflow), but it MUST stay: the
    ///      reference uses it as the explicit policy check, and the bare
    ///      `require` posture means tests assert `.toBeRevertedWithoutReason()`
    ///      on the policy boundary — bypassing the language check would change
    ///      the revert shape.
    function _register(
        uint256 id,
        address owner,
        uint256 duration,
        bool updateRegistry
    ) internal live onlyController returns (uint256) {
        require(available(id));
        require(
            block.timestamp + duration + GRACE_PERIOD >
                block.timestamp + GRACE_PERIOD
        );

        expiries[id] = block.timestamp + duration;
        if (_exists(id)) {
            _burn(id);
        }
        _mint(owner, id);
        if (updateRegistry) {
            rns.setSubnodeOwner(baseNode, bytes32(id), owner);
        }

        emit NameRegistered(id, owner, block.timestamp + duration);
        return block.timestamp + duration;
    }

    /// @notice Extends the expiry of an already-registered name. Allowed while
    ///         the name is in its registered or grace window.
    /// @dev The grace-window check `expiries[id] + GRACE_PERIOD >=
    ///      block.timestamp` and the overflow guard (Pitfall 8) match the
    ///      reference body-for-body.
    /// @param id The labelhash of the label to renew.
    /// @param duration Additional seconds to extend the expiry by.
    /// @return The new expiry timestamp.
    function renew(
        uint256 id,
        uint256 duration
    ) external override live onlyController returns (uint256) {
        require(expiries[id] + GRACE_PERIOD >= block.timestamp);
        require(
            expiries[id] + duration + GRACE_PERIOD > duration + GRACE_PERIOD
        );

        expiries[id] += duration;
        emit NameRenewed(id, expiries[id]);
        return expiries[id];
    }

    /// @notice Re-asserts registry ownership of `id` to `owner` on behalf of
    ///         the current ERC-721 owner (or an approved/operator). Reverts
    ///         (bare) if the registrar's TLD assignment is gone or the caller
    ///         is not approved/owner.
    /// @dev The `_isApprovedOrOwner` call routes through this contract's
    ///      `ownerOf` override (Pitfall 6), so expired tokens cannot be
    ///      reclaimed.
    /// @param id The labelhash of the label to reclaim.
    /// @param owner The address to assign registry ownership to.
    function reclaim(
        uint256 id,
        address owner
    ) external override live {
        require(_isApprovedOrOwner(msg.sender, id));
        rns.setSubnodeOwner(baseNode, bytes32(id), owner);
    }

    /// @notice ERC-165 dispatch. Returns true for the meta id, the ERC-721 id
    ///         (manual XOR derivation matching the reference), and the
    ///         `reclaim(uint256,address)` selector.
    /// @param interfaceID The interface id being queried.
    /// @return True if the interface is supported.
    function supportsInterface(
        bytes4 interfaceID
    ) public view override(ERC721, IERC165) returns (bool) {
        return
            interfaceID == INTERFACE_META_ID ||
            interfaceID == ERC721_ID ||
            interfaceID == RECLAIM_ID;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ABIResolver} from "./profiles/ABIResolver.sol";
import {AddrResolver} from "./profiles/AddrResolver.sol";
import {ContentHashResolver} from "./profiles/ContentHashResolver.sol";
import {DNSResolver} from "./profiles/DNSResolver.sol";
import {InterfaceResolver} from "./profiles/InterfaceResolver.sol";
import {NameResolver} from "./profiles/NameResolver.sol";
import {PubkeyResolver} from "./profiles/PubkeyResolver.sol";
import {TextResolver} from "./profiles/TextResolver.sol";
import {ExtendedResolver} from "./profiles/ExtendedResolver.sol";

/// @title RiseOwnedResolver — minimal single-owner resolver for the `.rise` node.
/// @notice Resolver instance that stores records ONLY when called by its OZ
///         `Ownable` owner. Used exclusively for the `.rise` TLD node's
///         records; per-name resolution on `*.rise` 2LDs uses `PublicResolver`
///         (Plan 04-03).
/// @dev Clean port of reference's `OwnedResolver` per D-03 / D-04 / Pitfall 9:
///      D-03 Rise-prefixed; D-04 inherits `ExtendedResolver` (ENSIP-10
///      `resolve(name, data)` staticcall forwarder) so wildcard probes against
///      `.rise` are universal-resolver compatible; Pitfall 9 omits the
///      ENSIP-24 generic-data mixin to match the reference's minimal
///      root-resolver posture; D-11 pragma `^0.8.26`; D-12 the inherited
///      `authorised(node)` modifier remains bare-revert; D-13 ERC-165
///      advertised via the multi-base override below (Ownable and
///      ExtendedResolver excluded — neither overrides `supportsInterface`).
/// @dev `isAuthorised(bytes32)` returns `msg.sender == owner()`; the registry
///      `rns` is NEVER consulted. Writes on `.rise` are governance actions of
///      the named owner account. Pitfall 7: `AddrResolver` precedes
///      `InterfaceResolver` (the ERC-165 fallback queries `addr(node)`).
/// @dev Constructor is implicit. OZ Ownable v4.9.3 seats `msg.sender` (the
///      deployer) as initial owner; Plan 05's deploy script calls
///      `transferOwnership(owner)` afterward (Phase 3 D-14 distinct-account
///      pattern).
contract RiseOwnedResolver is
    Ownable,
    ABIResolver,
    AddrResolver,
    ContentHashResolver,
    DNSResolver,
    InterfaceResolver,
    NameResolver,
    PubkeyResolver,
    TextResolver,
    ExtendedResolver
{
    /// @notice Single-source authorisation override — only the Ownable owner
    ///         may write records. The unused `bytes32` parameter is the
    ///         `node` arg required by the inherited `authorised(node)`
    ///         modifier surface; intentionally unnamed to suppress the
    ///         unused-parameter warning while preserving the override
    ///         signature.
    function isAuthorised(bytes32) internal view override returns (bool) {
        return msg.sender == owner();
    }

    /// @notice ERC-165 multi-base override. List matches the inherited
    ///         profile mixin set EXACTLY — c3-linearization requires every
    ///         mixin that overrides `supportsInterface` to appear here.
    function supportsInterface(
        bytes4 interfaceID
    )
        public
        view
        virtual
        override(
            ABIResolver,
            AddrResolver,
            ContentHashResolver,
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

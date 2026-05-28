// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RNS} from "../registry/RNS.sol";
import {IAddrResolver} from "../resolver/profiles/IAddrResolver.sol";
import {IRiseInteropResolver} from "./IRiseInteropResolver.sol";

/// @title RiseInteropResolver — node -> ERC-7930 interoperable address (INTEROP-01).
/// @notice Standalone, purely-additive read-only view. Resolves
///         node -> RNS.resolver(node) -> IAddrResolver.addr(node) [COIN_TYPE_ETH]
///         and encodes the result as an ERC-7930 interoperable address on the
///         constructor-injected chain id. NO resolver modification (D-09).
/// @dev Wire format (RF-2): Version(0x0001) || ChainType(0x0000) ||
///      ChainRefLen(1) || ChainRef(minimal big-endian) || AddrLen(0x14) ||
///      Addr(20 raw bytes). The chain reference is minimal-length big-endian
///      (leading zero bytes prohibited per the eip155 CAIP-350 profile).
contract RiseInteropResolver is IRiseInteropResolver {
    /// @notice The RNS registry the view reads resolvers from.
    RNS public immutable rns;

    /// @notice The chain id baked into every encoding. Constructor-injected
    ///         (D-10) — testnet 11155931, mainnet TBD. NEVER hardcoded.
    uint256 public immutable chainId;

    /// @param _rns The RNS registry.
    /// @param _chainId The chain reference to encode (e.g. 11155931 testnet).
    constructor(RNS _rns, uint256 _chainId) {
        rns = _rns;
        chainId = _chainId;
    }

    /// @inheritdoc IRiseInteropResolver
    function interopAddress(bytes32 node) external view returns (bytes memory) {
        address resolverAddr = rns.resolver(node);
        if (resolverAddr == address(0)) revert NoResolver(node);
        address primary = IAddrResolver(resolverAddr).addr(node);
        if (primary == address(0)) revert NoPrimaryAddress(node);   // D-11 / Pitfall 5
        return _encode7930(chainId, primary);
    }

    /// @dev ERC-7930 encoder (RF-2 Code Examples — pinned + golden-vector verified).
    function _encode7930(uint256 _chainId, address a) internal pure returns (bytes memory) {
        bytes memory chainRef = _minimalBE(_chainId);
        return abi.encodePacked(
            bytes2(0x0001),              // Version 1
            bytes2(0x0000),              // ChainType: EVM / eip155
            uint8(chainRef.length),      // ChainReferenceLength
            chainRef,                    // ChainReference (minimal big-endian)
            uint8(20),                   // AddressLength (EVM = 20)
            bytes20(a)                   // Address (raw 20 bytes)
        );
    }

    /// @dev Minimal big-endian encoding of a uint (leading zero bytes prohibited
    ///      per the eip155 CAIP-350 profile). chainId 0 defensively encodes as 1 byte.
    function _minimalBE(uint256 x) internal pure returns (bytes memory out) {
        if (x == 0) return hex"00";
        uint256 nbytes;
        uint256 t = x;
        while (t != 0) { nbytes++; t >>= 8; }
        out = new bytes(nbytes);
        for (uint256 i; i < nbytes; ++i) out[nbytes - 1 - i] = bytes1(uint8(x >> (8 * i)));
    }
}

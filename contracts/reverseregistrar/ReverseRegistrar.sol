// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {RNS} from "../registry/RNS.sol";
import {IReverseRegistrar} from "./IReverseRegistrar.sol";
import {RNSControllable} from "../root/RNSControllable.sol";

/// @notice ENS-fork posture: `NameResolver` is declared as a local abstract here
///         (mirrors the reference) so the file is import-free of resolver
///         profile contracts. Concrete resolvers (PublicResolver, RiseOwnedResolver)
///         satisfy this abstract because they expose the same `setName(bytes32,string)`
///         function (it's part of INameResolver in Phase 4).
abstract contract NameResolver {
    function setName(bytes32 node, string memory name) public virtual;
}

bytes32 constant lookup = 0x3031323334353637383961626364656600000000000000000000000000000000;
// ASCII: "0123456789abcdef"

bytes32 constant ADDR_REVERSE_NODE = 0x91d1777781884d03a6757a803996e38de2a42967fb37eeaca72729271025a9e2;
// namehash('addr.reverse') — chain-agnostic; RNS owns the same subnode shape as ENS.

/// @title ReverseRegistrar — registrar for the addr.reverse subnode.
/// @notice Clean-room port of ENS v1.7.0 `ReverseRegistrar.sol` under
///         pragma ^0.8.26 with the OZ v4 lineage and RNSControllable swap
///         (D-09). Legacy-fallback claim block dropped — RNS is greenfield.
///         ERC-165 `supportsInterface` added so the IReverseRegistrar
///         interfaceId is discoverable on-chain (downstream controller
///         plan 06-03's cross-check).
contract ReverseRegistrar is Ownable, RNSControllable, IReverseRegistrar {
    /// @dev The ERC-165 meta interface id — `bytes4(keccak256("supportsInterface(bytes4)"))`.
    bytes4 private constant INTERFACE_META_ID = 0x01ffc9a7;

    RNS public immutable rns;
    NameResolver public defaultResolver;

    event ReverseClaimed(address indexed addr, bytes32 indexed node);
    event DefaultResolverChanged(NameResolver indexed resolver);

    /// @dev Constructor
    /// @param _rns The address of the RNS registry.
    constructor(RNS _rns) {
        rns = _rns;
    }

    modifier authorised(address addr) {
        require(
            addr == msg.sender ||
                controllers[msg.sender] ||
                rns.isApprovedForAll(addr, msg.sender) ||
                ownsContract(addr),
            "ReverseRegistrar: Caller is not a controller or authorised by address or the address itself"
        );
        _;
    }

    function setDefaultResolver(address resolver) public override onlyOwner {
        require(
            address(resolver) != address(0),
            "ReverseRegistrar: Resolver address must not be 0"
        );
        defaultResolver = NameResolver(resolver);
        emit DefaultResolverChanged(NameResolver(resolver));
    }

    /// @dev Transfers ownership of the reverse RNS record associated with the
    ///      calling account.
    /// @param owner The address to set as the owner of the reverse record in RNS.
    /// @return The RNS node hash of the reverse record.
    function claim(address owner) public override returns (bytes32) {
        return claimForAddr(msg.sender, owner, address(defaultResolver));
    }

    /// @dev Transfers ownership of the reverse RNS record associated with the
    ///      calling account.
    /// @param addr The reverse record to set
    /// @param owner The address to set as the owner of the reverse record in RNS.
    /// @param resolver The resolver of the reverse node
    /// @return The RNS node hash of the reverse record.
    function claimForAddr(
        address addr,
        address owner,
        address resolver
    ) public override authorised(addr) returns (bytes32) {
        bytes32 labelHash = sha3HexAddress(addr);
        bytes32 reverseNode = keccak256(
            abi.encodePacked(ADDR_REVERSE_NODE, labelHash)
        );
        emit ReverseClaimed(addr, reverseNode);
        rns.setSubnodeRecord(ADDR_REVERSE_NODE, labelHash, owner, resolver, 0);
        return reverseNode;
    }

    /// @dev Transfers ownership of the reverse RNS record associated with the
    ///      calling account.
    /// @param owner The address to set as the owner of the reverse record in RNS.
    /// @param resolver The address of the resolver to set; 0 to leave unchanged.
    /// @return The RNS node hash of the reverse record.
    function claimWithResolver(
        address owner,
        address resolver
    ) public override returns (bytes32) {
        return claimForAddr(msg.sender, owner, resolver);
    }

    /// @dev Sets the `name()` record for the reverse RNS record associated with
    /// the calling account. First updates the resolver to the default reverse
    /// resolver if necessary.
    /// @param name The name to set for this address.
    /// @return The RNS node hash of the reverse record.
    function setName(string memory name) public override returns (bytes32) {
        return
            setNameForAddr(
                msg.sender,
                msg.sender,
                address(defaultResolver),
                name
            );
    }

    /// @dev Sets the `name()` record for the reverse RNS record associated with
    /// the account provided. Updates the resolver to a designated resolver
    /// Only callable by controllers and authorised users
    /// @param addr The reverse record to set
    /// @param owner The owner of the reverse node
    /// @param resolver The resolver of the reverse node
    /// @param name The name to set for this address.
    /// @return The RNS node hash of the reverse record.
    function setNameForAddr(
        address addr,
        address owner,
        address resolver,
        string memory name
    ) public override returns (bytes32) {
        bytes32 node_ = claimForAddr(addr, owner, resolver);
        NameResolver(resolver).setName(node_, name);
        return node_;
    }

    /// @dev Returns the node hash for a given account's reverse records.
    /// @param addr The address to hash
    /// @return The RNS node hash.
    function node(address addr) public pure override returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(ADDR_REVERSE_NODE, sha3HexAddress(addr))
            );
    }

    /// @dev An optimised function to compute the sha3 of the lower-case
    ///      hexadecimal representation of an Ethereum address.
    /// @param addr The address to hash
    /// @return ret The SHA3 hash of the lower-case hexadecimal encoding of the
    ///         input address.
    function sha3HexAddress(address addr) private pure returns (bytes32 ret) {
        assembly {
            for {
                let i := 40
            } gt(i, 0) {} {
                i := sub(i, 1)
                mstore8(i, byte(and(addr, 0xf), lookup))
                addr := div(addr, 0x10)
                i := sub(i, 1)
                mstore8(i, byte(and(addr, 0xf), lookup))
                addr := div(addr, 0x10)
            }

            ret := keccak256(0, 40)
        }
    }

    function ownsContract(address addr) internal view returns (bool) {
        try Ownable(addr).owner() returns (address owner) {
            return owner == msg.sender;
        } catch {
            return false;
        }
    }

    /// @notice ERC-165 introspection — advertises support for ERC-165 itself
    ///         and the `IReverseRegistrar` interface id (XOR of the 7 reference
    ///         function selectors). Downstream controller (plan 06-03) probes
    ///         this surface in its constructor to validate the reverse-
    ///         registrar address.
    /// @param interfaceID The interface identifier to query.
    /// @return True if `interfaceID` is supported.
    function supportsInterface(
        bytes4 interfaceID
    ) external pure returns (bool) {
        return
            interfaceID == INTERFACE_META_ID ||
            interfaceID == type(IReverseRegistrar).interfaceId;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {IDefaultReverseRegistrar} from "./IDefaultReverseRegistrar.sol";
import {StandaloneReverseRegistrar} from "./StandaloneReverseRegistrar.sol";
import {SignatureUtils} from "./SignatureUtils.sol";
import {RNSControllable} from "../root/RNSControllable.sol";

/// @title DefaultReverseRegistrar — chain-agnostic reverse registrar.
/// @notice Ported from ENS reference v1.7.0. The load-bearing edit (D-07 +
///         RESEARCH Focus 6) is the OZ v5 → v4 swap: reference's v5-only
///         message-hash helper is replaced by v4's `ECDSA` static method
///         (semantically identical — both prepend
///         "\x19Ethereum Signed Message:\n32" and re-keccak). The RNS
///         controller mixin replaces the reference's controller-gating
///         contract for controller gating (Phase 2 D-07 lineage).
contract DefaultReverseRegistrar is
    IDefaultReverseRegistrar,
    ERC165,
    StandaloneReverseRegistrar,
    RNSControllable
{
    using SignatureUtils for bytes;
    using ECDSA for bytes32;

    /// @inheritdoc IDefaultReverseRegistrar
    function setName(string calldata name) external {
        _setName(msg.sender, name);
    }

    /// @inheritdoc IDefaultReverseRegistrar
    function setNameForAddrWithSignature(
        address addr,
        uint256 signatureExpiry,
        string calldata name,
        bytes calldata signature
    ) external {
        // Follow ERC191 version 0 https://eips.ethereum.org/EIPS/eip-191
        bytes32 message = keccak256(
            abi.encodePacked(
                address(this),
                this.setNameForAddrWithSignature.selector,
                addr,
                signatureExpiry,
                name
            )
        ).toEthSignedMessageHash();

        signature.validateSignatureWithExpiry(addr, message, signatureExpiry);

        _setName(addr, name);
    }

    function setNameForAddr(
        address addr,
        string calldata name
    ) external onlyController {
        _setName(addr, name);
    }

    /// @inheritdoc ERC165
    function supportsInterface(
        bytes4 interfaceID
    ) public view override(ERC165, StandaloneReverseRegistrar) returns (bool) {
        return
            interfaceID == type(IDefaultReverseRegistrar).interfaceId ||
            super.supportsInterface(interfaceID);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

interface IUniversalSignatureValidator {
    function isValidSig(
        address _signer,
        bytes32 _hash,
        bytes calldata _signature
    ) external returns (bool);
}

/// @title SignatureUtils — signature validation with expiry, used by
///        DefaultReverseRegistrar.setNameForAddrWithSignature.
/// @notice Ported from ENS reference v1.7.0; pragma bumped to ^0.8.26 and
///         the OpenZeppelin signature-checker import path swapped to v4.
///         Cryptographic semantics unchanged — v4 and v5 expose the same
///         signature-validation surface.
/// @dev Pitfall 5 — the ERC-6492 universal-validator at the constant address
///      is a MAINNET deployment. On RiseChain testnet the validator is NOT
///      deployed, so the wrapped-signature branch reverts. EOA signatures
///      use the `else` branch (the v4 signature-checker library's static
///      method) and work without the validator.
library SignatureUtils {
    /// @notice The ERC6492 detection suffix.
    bytes32 private constant ERC6492_DETECTION_SUFFIX =
        0x6492649264926492649264926492649264926492649264926492649264926492;

    /// @notice The universal signature validator.
    IUniversalSignatureValidator public constant validator =
        IUniversalSignatureValidator(
            0x164af34fAF9879394370C7f09064127C043A35E9
        );

    /// @notice The signature is invalid
    error InvalidSignature();

    /// @notice The signature expiry is too high
    error SignatureExpiryTooHigh();

    /// @notice The signature has expired
    error SignatureExpired();

    /// @notice Validates a signature with expiry.
    ///
    /// @param signature The signature to validate.
    /// @param addr The address that signed the message.
    /// @param message The message that was signed.
    /// @param signatureExpiry The expiry of the signature.
    function validateSignatureWithExpiry(
        bytes calldata signature,
        address addr,
        bytes32 message,
        uint256 signatureExpiry
    ) internal {
        // ERC6492 check is done internally because UniversalSigValidator is not gas efficient.
        // We only want to use UniversalSigValidator for ERC6492 signatures.
        if (
            bytes32(signature[signature.length - 32:signature.length]) ==
            ERC6492_DETECTION_SUFFIX
        ) {
            if (!validator.isValidSig(addr, message, signature))
                revert InvalidSignature();
        } else {
            if (!SignatureChecker.isValidSignatureNow(addr, message, signature))
                revert InvalidSignature();
        }
        if (signatureExpiry < block.timestamp) revert SignatureExpired();
        if (signatureExpiry > block.timestamp + 1 hours)
            revert SignatureExpiryTooHigh();
    }
}

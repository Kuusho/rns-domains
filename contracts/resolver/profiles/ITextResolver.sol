// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title ITextResolver
/// @notice Profile interface for `text(node,key) => string` records.
/// @dev Ported verbatim-in-intent from
///      reference/ens-contracts/contracts/resolvers/profiles/ITextResolver.sol.
///      Pragma raised from `>=0.8.4` to `^0.8.26` per Phase 4 D-11.
interface ITextResolver {
    event TextChanged(
        bytes32 indexed node,
        string indexed indexedKey,
        string key,
        string value
    );

    /// Returns the text data associated with an ENS node and key.
    /// @param node The ENS node to query.
    /// @param key The text data key to query.
    /// @return The associated text data.
    function text(
        bytes32 node,
        string calldata key
    ) external view returns (string memory);
}

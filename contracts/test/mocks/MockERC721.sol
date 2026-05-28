//SPDX-License-Identifier: MIT
pragma solidity >=0.8.17 <0.9.0;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @title MockERC721 — minimal ERC-721 for the SubdomainRegistrar gate test (D-10).
/// @notice Mints sequential token ids to a passed list of holders, mirroring
///         MockERC20's ctor loop. The registrar's type-agnostic `_balanceOf`
///         gate only calls `balanceOf(address)` (which ERC721 implements), so
///         any holder reads a balance >= 1.
contract MockERC721 is ERC721 {
    uint256 private _nextId;

    constructor(
        string memory name,
        string memory symbol,
        address[] memory holders
    ) ERC721(name, symbol) {
        for (uint256 i = 0; i < holders.length; i++) {
            _mint(holders[i], _nextId);
            _nextId++;
        }
    }

    /// @notice Mint a specific token id to `to` (test convenience).
    function mint(address to, uint256 id) external {
        _mint(to, id);
    }
}

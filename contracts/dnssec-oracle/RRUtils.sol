// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BytesUtils} from "../utils/BytesUtils.sol";

/// @title RRUtils — TRIMMED port of the ENS reference DNSSEC oracle RR parser.
/// @notice Only the methods DNSResolver actually calls are ported (RRIterator
///         and friends). The DNSSEC-only helpers that depend on the external
///         buffer library are dropped entirely; see 04-RESEARCH.md "Pitfall 1".
/// @dev Path note: this library lives at `contracts/dnssec-oracle/RRUtils.sol` — a
///      SIBLING of `contracts/resolver/`, mirroring the reference layout — so that
///      Plan 04-02's `contracts/resolver/profiles/DNSResolver.sol` can use the
///      reference's verbatim relative import `../../dnssec-oracle/RRUtils.sol`.
library RRUtils {
    using BytesUtils for *;

    /// @dev Returns the number of bytes in the DNS name at 'offset' in 'self'.
    /// @param self The byte array to read a name from.
    /// @param offset The offset to start reading at.
    /// @return The length of the DNS name at 'offset', in bytes.
    function nameLength(
        bytes memory self,
        uint256 offset
    ) internal pure returns (uint256) {
        uint256 idx = offset;
        while (true) {
            assert(idx < self.length);
            uint256 labelLen = self.readUint8(idx);
            idx += labelLen + 1;
            if (labelLen == 0) {
                break;
            }
        }
        return idx - offset;
    }

    /// @dev Returns a DNS format name at the specified offset of self.
    /// @param self The byte array to read a name from.
    /// @param offset The offset to start reading at.
    /// @return ret The name.
    function readName(
        bytes memory self,
        uint256 offset
    ) internal pure returns (bytes memory ret) {
        uint256 len = nameLength(self, offset);
        return self.substring(offset, len);
    }

    /// @dev An iterator over resource records.
    struct RRIterator {
        bytes data;
        uint256 offset;
        uint16 dnstype;
        uint16 class;
        uint32 ttl;
        uint256 rdataOffset;
        uint256 nextOffset;
    }

    /// @dev Begins iterating over resource records.
    /// @param self The byte string to read from.
    /// @param offset The offset to start reading at.
    /// @return ret An iterator object.
    function iterateRRs(
        bytes memory self,
        uint256 offset
    ) internal pure returns (RRIterator memory ret) {
        ret.data = self;
        ret.nextOffset = offset;
        next(ret);
    }

    /// @dev Returns true iff there are more RRs to iterate.
    /// @param iter The iterator to check.
    /// @return True iff the iterator has finished.
    function done(RRIterator memory iter) internal pure returns (bool) {
        return iter.offset >= iter.data.length;
    }

    /// @dev Moves the iterator to the next resource record.
    /// @param iter The iterator to advance.
    function next(RRIterator memory iter) internal pure {
        iter.offset = iter.nextOffset;
        if (iter.offset >= iter.data.length) {
            return;
        }

        // Skip the name
        uint256 off = iter.offset + nameLength(iter.data, iter.offset);

        // Read type, class, and ttl
        iter.dnstype = iter.data.readUint16(off);
        off += 2;
        iter.class = iter.data.readUint16(off);
        off += 2;
        iter.ttl = iter.data.readUint32(off);
        off += 4;

        // Read the rdata
        uint256 rdataLength = iter.data.readUint16(off);
        off += 2;
        iter.rdataOffset = off;
        iter.nextOffset = off + rdataLength;
    }

    /// @dev Returns the name of the current record.
    /// @param iter The iterator.
    /// @return A new bytes object containing the owner name from the RR.
    function name(RRIterator memory iter) internal pure returns (bytes memory) {
        return
            iter.data.substring(
                iter.offset,
                nameLength(iter.data, iter.offset)
            );
    }

    /// @dev Returns the rdata portion of the current record.
    /// @param iter The iterator.
    /// @return A new bytes object containing the RR's RDATA.
    function rdata(
        RRIterator memory iter
    ) internal pure returns (bytes memory) {
        return
            iter.data.substring(
                iter.rdataOffset,
                iter.nextOffset - iter.rdataOffset
            );
    }
}
